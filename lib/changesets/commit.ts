import "server-only";

import {
  changesetContentHash,
  changesetDisplayStatus,
  verifyChangesetSignature,
  type ChangesetStatus,
} from "@/lib/changesets";
import { getRepo } from "@/lib/github/read";
import { readToken } from "@/lib/github/token";
import { AGENT_BRANCH_PREFIX } from "@/lib/branch";
import {
  GithubWriteError,
  agentBranchName,
  assertAgentBranch,
  assertSafeBranch,
  commitProposal,
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
 * The write itself is one branch and one PR. Nothing here can name a branch;
 * `agentBranchName` derives it from the changeset id and `lib/github/write.ts`
 * refuses anything else. A retry reuses the stored branch, commit and PR rather
 * than creating a second one.
 */

type Client = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

export type ApprovalResult =
  | {
      ok: true;
      /** Null when the approval was a direct commit instead of a pull request. */
      prUrl: string | null;
      prNumber: number | null;
      commitSha: string;
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
  pr_url: string | null;
  pr_number: number | null;
  failure: string | null;
};

function existingResult(row: ChangesetRow): ApprovalResult | null {
  if (!row.commit_sha || !row.branch_name) return null;

  // A committed row is done. Without a PR url it is only done when the branch
  // is not an agent branch; an agent branch with no PR is a half-finished
  // pull request that a retry should still complete.
  const direct = !row.branch_name.startsWith(AGENT_BRANCH_PREFIX);

  if (row.pr_url && typeof row.pr_number === "number") {
    return {
      ok: true,
      target: "pull-request",
      prUrl: row.pr_url,
      prNumber: row.pr_number,
      commitSha: row.commit_sha,
      branch: row.branch_name,
      alreadyCommitted: true,
    };
  }

  if (row.status === "committed" && direct) {
    return {
      ok: true,
      target: "branch",
      prUrl: null,
      prNumber: null,
      commitSha: row.commit_sha,
      branch: row.branch_name,
      alreadyCommitted: true,
    };
  }

  return null;
}

export async function approveChangesetAndOpenPullRequest(
  supabase: Client,
  input: {
    changesetId: string;
    owner: string;
    sealKey: string | null;
    /** When set, commit straight to this branch instead of opening a PR. */
    target?: { branch: string };
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
      "id, chat_id, status, repo_full_name, base_sha, expires_at, content_hash, signature, branch_name, commit_sha, pr_url, pr_number, failure"
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
    .select("path, proposed_content, error")
    .eq("changeset_id", row.id)
    .eq("accepted", true);

  if (fileError) return { ok: false, error: fileError.message };

  const files: ProposedFile[] = ((fileRows ?? []) as Array<{
    path: string;
    proposed_content: string;
    error: string | null;
  }>)
    .filter((file) => file.error === null)
    .map((file) => ({ path: String(file.path), content: String(file.proposed_content) }));

  if (files.length === 0) {
    return { ok: false, error: "No files are accepted, so there is nothing to approve." };
  }

  const contentHash = changesetContentHash(
    files.map((file) => ({ path: file.path, proposed: file.content }))
  );

  if (!row.content_hash || row.content_hash !== contentHash) {
    return {
      ok: false,
      error: "The stored content hash does not match these files. Nothing was opened; ask for a fresh changeset.",
    };
  }

  if (
    !row.signature ||
    !verifyChangesetSignature(
      { changesetId: row.id, baseSha: row.base_sha, contentHash },
      row.signature,
      input.sealKey
    )
  ) {
    return {
      ok: false,
      error: "The signature does not match this content. Nothing was opened; ask for a fresh changeset.",
    };
  }

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
      .select("branch_name, commit_sha, pr_url, pr_number, status")
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

    const { error: saveError } = await supabase
      .from("changesets")
      .update({
        status: "committed",
        branch_name: outcome.branch,
        commit_sha: outcome.commitSha,
        pr_url: outcome.prUrl,
        pr_number: outcome.prNumber,
        failure: null,
      })
      .eq("id", row.id)
      .eq("owner", input.owner);

    if (saveError) {
      return {
        ok: false,
        error: `The pull request ${outcome.prUrl} exists, but the changeset could not be updated: ${saveError.message}`,
      };
    }

    return {
      ok: true,
      target: input.target ? "branch" : "pull-request",
      prUrl: outcome.prUrl,
      prNumber: outcome.prNumber,
      commitSha: outcome.commitSha,
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
