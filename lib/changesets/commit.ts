import "server-only";

import {
  changesetContentHash,
  changesetDisplayStatus,
  verifyChangesetSignature,
  type ChangesetStatus,
} from "@/lib/changesets";
import { runApply, type ApplyFile } from "@/lib/changesets/apply";
import { defaultBranchWritesAllowed } from "@/lib/github/autowrite";
import { getRepo, resolveBranchSha } from "@/lib/github/read";
import { rebaseChangeset } from "@/lib/sandbox/rebase";
import { readToken } from "@/lib/github/token";
import { AGENT_BRANCH_PREFIX } from "@/lib/branch";
import {
  GithubWriteError,
  agentBranchName,
  assertAgentBranch,
  assertSafeBranch,
  commitProposal,
  mergeProposal,
  type ChangedFile,
  type ProposedFile,
} from "@/lib/github/write";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Approval: the one path from a signed changeset to a pull request.
 *
 * The order is the point. Owner, status, expiry, content hash and signature are
 * checked before a token is opened or a request is made. Only then is the
 * changeset claimed with a compare-and-set, so two clicks cannot both write.
 *
 * The write itself is one branch and one PR. The head is derived from the
 * changeset id unless the reader names a branch, and `lib/github/write.ts`
 * refuses the default branch and anything git would not accept. A retry reuses
 * the stored branch, commit and PR rather than creating a second one.
 *
 * An approval no longer leaves the PR for the reader to merge on GitHub. The
 * same call waits for mergeability, re-applies the edits when the default branch
 * moved, squash-merges, and stores the merge commit. A merge that cannot finish
 * marks the changeset failed and leaves the PR for inspection.
 */

type Client = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

export type ApprovalResult =
  | {
      ok: true;
      /** Null when the approval was a direct commit instead of a pull request. */
      prUrl: string | null;
      prNumber: number | null;
      commitSha: string;
      /** The squash commit GitHub created, once the change was applied. */
      mergeCommitSha: string | null;
      branch: string;
      target: "pull-request" | "branch";
      alreadyCommitted: boolean;
    }
  | { ok: false; error: string };

type ChangesetRow = {
  id: string;
  chat_id: string;
  status: ChangesetStatus;
  repo_full_name: string;
  base_sha: string;
  expires_at: string;
  content_hash: string | null;
  signature: string | null;
  branch_name: string | null;
  commit_sha: string | null;
  merge_commit_sha: string | null;
  pr_url: string | null;
  pr_number: number | null;
  failure: string | null;
};

function existingResult(row: ChangesetRow): ApprovalResult | null {
  // Only an applied row is done. A failed merge keeps its pull request and
  // commit, and must not be mistaken for an approval that succeeded.
  if (row.status !== "committed" || !row.commit_sha || !row.branch_name) return null;

  const direct = !row.branch_name.startsWith(AGENT_BRANCH_PREFIX);

  if (row.pr_url && typeof row.pr_number === "number") {
    return {
      ok: true,
      target: "pull-request",
      prUrl: row.pr_url,
      prNumber: row.pr_number,
      commitSha: row.commit_sha,
      mergeCommitSha: row.merge_commit_sha,
      branch: row.branch_name,
      alreadyCommitted: true,
    };
  }

  if (direct) {
    return {
      ok: true,
      target: "branch",
      prUrl: null,
      prNumber: null,
      commitSha: row.commit_sha,
      mergeCommitSha: row.merge_commit_sha,
      branch: row.branch_name,
      alreadyCommitted: true,
    };
  }

  return null;
}

type SignedRow = {
  id: string;
  base_sha: string;
  content_hash: string | null;
  signature: string | null;
};

/**
 * The signature check every apply path shares: the stored hash must match the
 * accepted files, and the seal must prove that hash was signed for this
 * changeset at this base commit. Returns the sentence to show, or null.
 */
function verifySignedFiles(
  row: SignedRow,
  files: Array<{ path: string; content: string }>,
  sealKey: string
): string | null {
  const contentHash = changesetContentHash(
    files.map((file) => ({ path: file.path, proposed: file.content }))
  );

  if (!row.content_hash || row.content_hash !== contentHash) {
    return "The stored content hash does not match these files. Nothing was changed; ask for a fresh changeset.";
  }

  if (
    !row.signature ||
    !verifyChangesetSignature(
      { changesetId: row.id, baseSha: row.base_sha, contentHash },
      row.signature,
      sealKey
    )
  ) {
    return "The signature does not match this content. Nothing was changed; ask for a fresh changeset.";
  }

  return null;
}

export async function approveChangesetAndOpenPullRequest(
  supabase: Client,
  input: {
    changesetId: string;
    owner: string;
    sealKey: string | null;
    /**
     * When set, write to this branch instead of the derived one.
     *
     * `explicit` means the reader named this branch themselves — typed it on the
     * review card, or asked for it in the chat. That is the permission to write
     * the default branch directly: the derived destination is still a new
     * branch and a pull request, and the env flag only matters for a write that
     * nobody asked about by name.
     */
    target?: { branch: string; explicit?: boolean };
  }
): Promise<ApprovalResult> {
  if (!input.sealKey) {
    return {
      ok: false,
      error: "GITHUB_TOKEN_KEY is not configured, so a changeset cannot be verified.",
    };
  }

  if (input.target) {
    try {
      assertSafeBranch(input.target.branch.trim());
    } catch (caught) {
      return {
        ok: false,
        error:
          caught instanceof Error
            ? caught.message
            : "That branch name is not valid.",
      };
    }
  }

  const { data, error } = await supabase
    .from("changesets")
    .select(
      "id, chat_id, status, repo_full_name, base_sha, expires_at, content_hash, signature, branch_name, commit_sha, merge_commit_sha, pr_url, pr_number, failure"
    )
    .eq("id", input.changesetId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That changeset no longer exists." };

  const row = data as ChangesetRow;

  // Idempotency before anything else: an approval that already opened a PR
  // returns that PR even if its TTL has since passed.
  const existing = existingResult(row);
  if (existing) return existing;

  const status = changesetDisplayStatus(row);

  // A merge that could not finish is a recorded outcome, not a retry prompt.
  if (status === "failed" && row.failure) {
    return { ok: false, error: row.failure };
  }

  if (status === "expired") {
    return {
      ok: false,
      error: "That changeset expired after six hours. Nothing was opened; ask for a fresh one.",
    };
  }

  if (status !== "ready" && status !== "approved") {
    return {
      ok: false,
      error: `That changeset is ${status}; only a ready or failed approval can be committed.`,
    };
  }

  const { data: fileRows, error: fileError } = await supabase
    .from("changeset_files")
    .select("path, mode, original_content, proposed_content, error")
    .eq("changeset_id", row.id)
    .eq("accepted", true);

  if (fileError) return { ok: false, error: fileError.message };

  const changedFiles: ChangedFile[] = ((fileRows ?? []) as Array<{
    path: string;
    mode: string;
    original_content: string | null;
    proposed_content: string;
    error: string | null;
  }>)
    .filter((file) => file.error === null)
    .map((file) => ({
      path: String(file.path),
      mode: file.mode === "replace" ? "replace" : "write",
      original: file.original_content === null ? null : String(file.original_content),
      proposed: String(file.proposed_content),
    }));

  const files: ProposedFile[] = changedFiles.map((file) => ({
    path: file.path,
    content: file.proposed,
  }));

  if (files.length === 0) {
    return { ok: false, error: "No files are accepted, so there is nothing to approve." };
  }

  const signatureError = verifySignedFiles(
    row,
    files.map((file) => ({ path: file.path, content: file.content })),
    input.sealKey
  );

  if (signatureError) return { ok: false, error: signatureError };

  const { data: chat, error: chatError } = await supabase
    .from("chats")
    .select("repo_base_sha, repo_branch")
    .eq("id", row.chat_id)
    .maybeSingle();

  if (chatError) return { ok: false, error: chatError.message };
  if (!chat) return { ok: false, error: "The chat for this changeset no longer exists." };

  const chatRow = chat as { repo_base_sha: string | null; repo_branch: string | null };

  if (chatRow.repo_base_sha && chatRow.repo_base_sha !== row.base_sha) {
    return {
      ok: false,
      error: `The chat moved to ${chatRow.repo_base_sha.slice(0, 7)}; this diff was computed at ${row.base_sha.slice(0, 7)}. Nothing was opened.`,
    };
  }

  let github: Awaited<ReturnType<typeof readToken>> = null;
  try {
    github = await readToken(supabase, input.owner);
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : "The GitHub token could not be opened.",
    };
  }

  if (!github) {
    return { ok: false, error: "Connect GitHub before approving a changeset." };
  }

  let defaultBranch: string;
  try {
    const repo = await getRepo(github.token, row.repo_full_name);
    defaultBranch = repo.defaultBranch;
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : "GitHub could not read that repository.",
    };
  }

  const branch = input.target ? input.target.branch.trim() : agentBranchName(row.id);

  try {
    if (input.target) {
      assertSafeBranch(branch);
    } else {
      assertAgentBranch(branch, defaultBranch);
    }
  } catch (caught) {
    return {
      ok: false,
      error: caught instanceof Error ? caught.message : "That branch cannot be written.",
    };
  }

  const baseBranch = chatRow.repo_branch ?? defaultBranch;
  const approvedAt = new Date().toISOString();

  // Claim with compare-and-set. A retry after a recorded failure clears the
  // failure; a second click while a write is in flight does not.
  let claimed = false;

  if (row.status === "ready") {
    const { data: claimedRow } = await supabase
      .from("changesets")
      .update({
        status: "approved",
        approved_at: approvedAt,
        failure: null,
        branch_name: branch,
      })
      .eq("id", row.id)
      .eq("owner", input.owner)
      .eq("status", "ready")
      .select("id")
      .maybeSingle();

    claimed = Boolean(claimedRow);
  } else if (row.status === "approved" && row.failure) {
    const { data: resumed } = await supabase
      .from("changesets")
      .update({ failure: null, branch_name: branch })
      .eq("id", row.id)
      .eq("owner", input.owner)
      .eq("status", "approved")
      .not("failure", "is", null)
      .select("id")
      .maybeSingle();

    claimed = Boolean(resumed);
  }

  if (!claimed) {
    const { data: latest } = await supabase
      .from("changesets")
      .select("branch_name, commit_sha, merge_commit_sha, pr_url, pr_number, status")
      .eq("id", row.id)
      .maybeSingle();

    const current = latest as ChangesetRow | null;
    const raced = current ? existingResult(current) : null;
    if (raced) return raced;

    return {
      ok: false,
      error: "This changeset is already being approved. Retry in a moment.",
    };
  }

  try {
    const outcome = await commitProposal({
      token: github.token,
      repo: row.repo_full_name,
      defaultBranch,
      baseBranch,
      baseSha: row.base_sha,
      files,
      changesetId: row.id,
      existingCommitSha: row.commit_sha ?? undefined,
      targetBranch: input.target?.branch.trim(),
      allowDefaultBranch:
        defaultBranchWritesAllowed() || input.target?.explicit === true,
      onProgress: async (progress) => {
        // Persisted before the next request so a partial write is resumable.
        await supabase
          .from("changesets")
          .update({
            branch_name: progress.branch,
            commit_sha: progress.commitSha ?? row.commit_sha ?? null,
          })
          .eq("id", row.id)
          .eq("owner", input.owner);
      },
    });

    let mergeCommitSha: string | null = null;

    // The PR exists; applying it is the rest of the approval. A suggestion that
    // can no longer be re-applied is closed by `mergeProposal` itself.
    if (outcome.prUrl && typeof outcome.prNumber === "number") {
      const merged = await mergeProposal({
        token: github.token,
        repo: row.repo_full_name,
        defaultBranch,
        branch: outcome.branch,
        prNumber: outcome.prNumber,
        changesetId: row.id,
        files: changedFiles,
      });

      if (!merged.ok) {
        await supabase
          .from("changesets")
          .update({
            status: "failed",
            branch_name: outcome.branch,
            commit_sha: outcome.commitSha,
            merge_commit_sha: null,
            pr_url: outcome.prUrl,
            pr_number: outcome.prNumber,
            failure: merged.error,
          })
          .eq("id", row.id)
          .eq("owner", input.owner);

        return { ok: false, error: merged.error };
      }

      mergeCommitSha = merged.mergeCommitSha;
    }

    const { error: saveError } = await supabase
      .from("changesets")
      .update({
        status: "committed",
        branch_name: outcome.branch,
        commit_sha: outcome.commitSha,
        merge_commit_sha: mergeCommitSha,
        pr_url: outcome.prUrl,
        pr_number: outcome.prNumber,
        failure: null,
      })
      .eq("id", row.id)
      .eq("owner", input.owner);

    if (saveError) {
      return {
        ok: false,
        error: `The change was applied, but the changeset could not be updated: ${saveError.message}`,
      };
    }

    return {
      ok: true,
      // The destination the write actually used, not the one the form asked
      // for: a default or moved branch becomes a new branch and a PR.
      target: outcome.prUrl ? "pull-request" : "branch",
      prUrl: outcome.prUrl,
      prNumber: outcome.prNumber,
      commitSha: outcome.commitSha,
      mergeCommitSha,
      branch: outcome.branch,
      alreadyCommitted: false,
    };
  } catch (caught) {
    const message =
      caught instanceof GithubWriteError || caught instanceof Error
        ? caught.message
        : "GitHub did not answer.";

    // The changeset stays approved with the failure recorded. A retry reuses
    // the branch and any commit already created; it never starts a second PR.
    await supabase
      .from("changesets")
      .update({ failure: message })
      .eq("id", row.id)
      .eq("owner", input.owner);

    return { ok: false, error: message };
  }
}

// ── Apply now ────────────────────────────────────────────────────────────────
//
// "Apply now" runs the same signed content through the same owner, status, TTL,
// hash and signature checks. The difference is the destination: it writes the
// repository's default branch instead of opening a pull request on an agent
// branch. When the default branch has moved, the change is re-applied in a
// sandbox first; a re-apply that cannot reproduce the reviewed text fails the
// changeset and never reaches GitHub.
//
// The default-branch safety check is not bypassed. Without the operator's
// `OPENMI_ALLOW_DEFAULT_BRANCH`, `commitProposal` gives the change its own agent
// branch and a pull request, exactly as the approval path does.

export type ApplyNowResult =
  | {
      ok: true;
      commitSha: string;
      branch: string;
      prUrl: string | null;
      message: string;
    }
  | { ok: false; error: string };

export async function applyChangesetNow(
  supabase: Client,
  input: { changesetId: string; owner: string; sealKey: string | null }
): Promise<ApplyNowResult> {
  if (!input.sealKey) {
    return {
      ok: false,
      error: "GITHUB_TOKEN_KEY is not configured, so a change cannot be verified.",
    };
  }

  const { data, error } = await supabase
    .from("changesets")
    .select(
      "id, status, repo_full_name, base_sha, expires_at, content_hash, signature, branch_name, commit_sha, merge_commit_sha, pr_url, pr_number, failure"
    )
    .eq("id", input.changesetId)
    .eq("owner", input.owner)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That change no longer exists." };

  const row = data as ChangesetRow;

  // Idempotency first: a change that already landed is done, even if its TTL
  // has since passed and even if this is the second click.
  if (row.status === "committed" && row.commit_sha) {
    return {
      ok: true,
      commitSha: row.commit_sha,
      branch: row.branch_name ?? "",
      prUrl: row.pr_url,
      message: "Changes applied.",
    };
  }

  const status = changesetDisplayStatus(row);

  if (status === "expired") {
    return {
      ok: false,
      error:
        "That suggestion expired after six hours. Nothing was applied; ask for a fresh one.",
    };
  }

  if (status === "rejected") {
    return {
      ok: false,
      error: "That suggestion was discarded. Ask the AI to propose it again.",
    };
  }

  // A write that failed after claiming is resumable; anything else is not an
  // apply this app can honour.
  const resuming = status === "approved" && Boolean(row.failure);

  if (status !== "ready" && !resuming) {
    return {
      ok: false,
      error: `That change is ${status}; only a ready suggestion can be applied.`,
    };
  }

  const { data: fileRows, error: fileError } = await supabase
    .from("changeset_files")
    .select("path, mode, original_content, proposed_content, error")
    .eq("changeset_id", row.id)
    .eq("accepted", true);

  if (fileError) return { ok: false, error: fileError.message };

  const files: ApplyFile[] = ((fileRows ?? []) as Array<{
    path: string;
    mode: string;
    original_content: string | null;
    proposed_content: string;
    error: string | null;
  }>)
    .filter((file) => file.error === null)
    .map((file) => ({
      path: String(file.path),
      mode: file.mode === "replace" ? "replace" : "write",
      original: file.original_content === null ? null : String(file.original_content),
      proposed: String(file.proposed_content),
    }));

  if (files.length === 0) {
    return { ok: false, error: "No files are accepted, so there is nothing to apply." };
  }

  const signatureError = verifySignedFiles(
    row,
    files.map((file) => ({ path: file.path, content: file.proposed })),
    input.sealKey
  );

  if (signatureError) return { ok: false, error: signatureError };

  let opened: Awaited<ReturnType<typeof readToken>> = null;

  try {
    opened = await readToken(supabase, input.owner);
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error
          ? caught.message
          : "The GitHub token could not be opened.",
    };
  }

  if (!opened) return { ok: false, error: "Connect GitHub before applying a change." };

  const token = opened.token;

  let live: { defaultBranch: string; head: string };

  try {
    const repo = await getRepo(token, row.repo_full_name);
    live = {
      defaultBranch: repo.defaultBranch,
      head: await resolveBranchSha(token, row.repo_full_name, repo.defaultBranch),
    };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof Error
          ? caught.message
          : "GitHub could not read that repository.",
    };
  }

  const { defaultBranch, head } = live;

  // Claim with compare-and-set. A re-apply can take a while; a second click
  // while it runs must not start a second apply.
  let claimed = false;

  if (row.status === "ready") {
    const { data: claimedRow } = await supabase
      .from("changesets")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        failure: null,
        branch_name: defaultBranch,
      })
      .eq("id", row.id)
      .eq("owner", input.owner)
      .eq("status", "ready")
      .select("id")
      .maybeSingle();

    claimed = Boolean(claimedRow);
  } else if (row.status === "approved" && row.failure) {
    const { data: resumed } = await supabase
      .from("changesets")
      .update({ failure: null, branch_name: defaultBranch })
      .eq("id", row.id)
      .eq("owner", input.owner)
      .eq("status", "approved")
      .not("failure", "is", null)
      .select("id")
      .maybeSingle();

    claimed = Boolean(resumed);
  }

  if (!claimed) {
    return {
      ok: false,
      error: "This change is already being applied. Retry in a moment.",
    };
  }

  const outcome = await runApply({
    repo: row.repo_full_name,
    baseSha: row.base_sha,
    head,
    files,
    steps: {
      // Read-only: two archives and a disk of its own. The sandbox never holds
      // the token, and this path never updates a ref.
      rebase: (attempt) =>
        rebaseChangeset({
          token,
          repo: attempt.repo,
          baseSha: attempt.baseSha,
          newHead: attempt.newHead,
          files: attempt.files,
        }),
      write: (write) =>
        commitProposal({
          token,
          repo: row.repo_full_name,
          defaultBranch,
          baseBranch: defaultBranch,
          baseSha: write.baseSha,
          files: write.files,
          changesetId: row.id,
          existingCommitSha: row.commit_sha ?? undefined,
          targetBranch: defaultBranch,
          // The default branch is written only when the operator allows it;
          // otherwise `commitProposal` gives the change its own branch and a
          // pull request, exactly as the approval path does.
          allowDefaultBranch: defaultBranchWritesAllowed(),
          onProgress: async (progress) => {
            await supabase
              .from("changesets")
              .update({
                branch_name: progress.branch,
                commit_sha: progress.commitSha ?? row.commit_sha ?? null,
              })
              .eq("id", row.id)
              .eq("owner", input.owner);
          },
        }),
    },
    record: async (patch) => {
      const { error: recordError } = await supabase
        .from("changesets")
        .update(patch)
        .eq("id", row.id)
        .eq("owner", input.owner);

      return recordError
        ? { ok: false as const, error: recordError.message }
        : { ok: true as const };
    },
  });

  if (!outcome.ok) return { ok: false, error: outcome.error };

  return {
    ok: true,
    commitSha: outcome.commitSha,
    branch: outcome.branch,
    prUrl: outcome.prUrl,
    message: outcome.prUrl
      ? "The change is saved and waiting for you on GitHub."
      : "Changes applied.",
  };
}
