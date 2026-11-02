import "server-only";

import {
  CHANGESET_TTL_MS,
  MAX_CHANGESET_FILES,
  applyEdit,
  changesetContentHash,
  changesetDisplayStatus,
  signChangeset,
  verifyChangesetSignature,
  type ChangesetStatus,
  type EditRequest,
} from "@/lib/changesets";
import { unifiedDiff } from "@/lib/diff";
import { GithubError, getFile } from "@/lib/github/read";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Reading and writing changesets.
 *
 * Every write is keyed on the account the request is already signed in as, and
 * every select relies on the owner policies in `006_changesets.sql`. Nothing
 * here calls GitHub with a write verb: a proposal is a draft in Postgres until
 * a later phase opens a pull request.
 *
 * Finalising is where a proposal stops being a draft. Until then it has no
 * signature and cannot be approved; the database refuses to store a ready row
 * without one.
 */

type Client = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

export type ChangesetRow = {
  id: string;
  status: ChangesetStatus;
  base_sha: string;
  repo_full_name: string;
  expires_at: string;
  created_at: string;
};

export type ChangesetFileRow = {
  id: string;
  changeset_id: string;
  path: string;
  mode: "write" | "replace";
  diff: string;
  additions: number;
  deletions: number;
  diff_truncated: boolean;
  accepted: boolean;
  error: string | null;
};

export type ReviewChangeset = ChangesetRow & { files: ChangesetFileRow[] };

export const MAX_REVIEW_CARDS = 2;

type Failure = { ok: false; error: string };

export async function createChangeset(
  supabase: Client,
  input: {
    owner: string;
    chatId: string;
    turnId: string;
    repo: string;
    baseSha: string;
  }
): Promise<{ ok: true; id: string } | Failure> {
  const { data, error } = await supabase
    .from("changesets")
    .insert({
      owner: input.owner,
      chat_id: input.chatId,
      turn_id: input.turnId,
      repo_full_name: input.repo,
      base_sha: input.baseSha,
      status: "draft",
      expires_at: new Date(Date.now() + CHANGESET_TTL_MS).toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "The changeset could not be created." };
  }

  return { ok: true, id: String((data as { id: string }).id) };
}

/**
 * A draft from the same turn, so a paused turn continues adding to one card
 * rather than starting a second one.
 */
export async function findDraftChangeset(
  supabase: Client,
  turnId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("changesets")
    .select("id")
    .eq("turn_id", turnId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? String((data as { id: string }).id) : null;
}

export async function addEdits(
  supabase: Client,
  input: {
    changesetId: string;
    owner: string;
    token: string;
    repo: string;
    sha: string;
    edits: EditRequest[];
  }
): Promise<
  | { ok: true; added: number; failed: number; text: string }
  | Failure
> {
  const { count } = await supabase
    .from("changeset_files")
    .select("id", { count: "exact", head: true })
    .eq("changeset_id", input.changesetId);

  const used = count ?? 0;

  if (used >= MAX_CHANGESET_FILES) {
    return {
      ok: false,
      error: `this changeset already holds ${used} files; the cap is ${MAX_CHANGESET_FILES}`,
    };
  }

  if (used + input.edits.length > MAX_CHANGESET_FILES) {
    return {
      ok: false,
      error: `only ${MAX_CHANGESET_FILES - used} more file(s) fit in this changeset`,
    };
  }

  const { data: existingRows } = await supabase
    .from("changeset_files")
    .select("path")
    .eq("changeset_id", input.changesetId);

  const existing = new Set(
    ((existingRows ?? []) as Array<{ path: string }>).map((row) => String(row.path))
  );

  let added = 0;
  let failed = 0;
  const notes: string[] = [];

  for (const edit of input.edits) {
    if (existing.has(edit.path)) {
      failed += 1;
      notes.push(`${edit.path}: already proposed in this changeset`);
      continue;
    }

    let original: string | null = null;
    let readError: string | null = null;

    try {
      const file = await getFile(input.token, input.repo, input.sha, edit.path);
      original = file.text;
    } catch (caught) {
      // A missing file is a legitimate target for a whole-file write and an
      // impossible target for a replacement. Anything else — a binary file, a
      // rate limit, a dropped connection — is not guessed around.
      if (
        caught instanceof GithubError &&
        caught.failure === "not-found" &&
        edit.mode === "write"
      ) {
        original = null;
      } else {
        readError =
          caught instanceof Error
            ? caught.message
            : "the file could not be read at the base commit";
      }
    }

    const outcome = readError
      ? { ok: false as const, error: readError }
      : applyEdit(original, edit);

    if (!outcome.ok) {
      failed += 1;
      notes.push(`${edit.path}: ${outcome.error}`);

      const { error } = await supabase.from("changeset_files").insert({
        changeset_id: input.changesetId,
        owner: input.owner,
        path: edit.path,
        mode: edit.mode,
        original_content: original,
        proposed_content: original ?? "",
        diff: "",
        additions: 0,
        deletions: 0,
        diff_truncated: false,
        accepted: false,
        error: outcome.error,
      });

      if (error) return { ok: false, error: error.message };
      continue;
    }

    const diff = unifiedDiff(original ?? "", outcome.proposed);

    const { error } = await supabase.from("changeset_files").insert({
      changeset_id: input.changesetId,
      owner: input.owner,
      path: edit.path,
      mode: edit.mode,
      original_content: original,
      proposed_content: outcome.proposed,
      diff: diff.text,
      additions: diff.additions,
      deletions: diff.deletions,
      diff_truncated: diff.truncated,
      accepted: true,
      error: null,
    });

    if (error) return { ok: false, error: error.message };
    added += 1;
  }

  const summary = `${added} file(s) proposed, ${failed} failed. The user reviews the diff; nothing was written to GitHub.`;

  return {
    ok: true,
    added,
    failed,
    text: notes.length > 0 ? `${summary}\n${notes.join("\n")}` : summary,
  };
}

/**
 * Signs the accepted files and moves a draft to ready.
 *
 * A changeset whose every edit failed is `failed`, not an empty ready card: the
 * difference is a real observation the reader can act on.
 */
export async function finalizeChangeset(
  supabase: Client,
  input: { changesetId: string; baseSha: string; sealKey: string | null }
): Promise<{ status: ChangesetStatus; files: number }> {
  const { data } = await supabase
    .from("changeset_files")
    .select("path, proposed_content, accepted, error")
    .eq("changeset_id", input.changesetId);

  const rows = (data ?? []) as Array<{
    path: string;
    proposed_content: string;
    accepted: boolean;
    error: string | null;
  }>;

  const successful = rows.filter((row) => row.error === null);

  if (successful.length === 0) {
    await supabase
      .from("changesets")
      .update({ status: "failed", content_hash: null, signature: null })
      .eq("id", input.changesetId);

    return { status: "failed", files: 0 };
  }

  const accepted = successful.filter((row) => row.accepted);
  const contentHash = changesetContentHash(
    accepted.map((row) => ({ path: row.path, proposed: row.proposed_content }))
  );
  const signature = input.sealKey
    ? signChangeset(
        { changesetId: input.changesetId, baseSha: input.baseSha, contentHash },
        input.sealKey
      )
    : null;

  const status: ChangesetStatus = signature ? "ready" : "draft";

  await supabase
    .from("changesets")
    .update({ status, content_hash: contentHash, signature })
    .eq("id", input.changesetId)
    .eq("status", "draft");

  return { status, files: successful.length };
}

export async function reviewChangesetFile(
  supabase: Client,
  input: {
    owner: string;
    changesetId: string;
    fileId: string;
    accepted: boolean;
    sealKey: string | null;
  }
): Promise<{ ok: true } | Failure> {
  if (!input.sealKey) {
    return {
      ok: false,
      error: "GITHUB_TOKEN_KEY is not configured, so a changeset cannot be re-signed.",
    };
  }

  const { data: row, error } = await supabase
    .from("changesets")
    .select("id, status, base_sha, expires_at")
    .eq("id", input.changesetId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "That changeset no longer exists." };

  const changeset = row as {
    id: string;
    status: ChangesetStatus;
    base_sha: string;
    expires_at: string;
  };
  const status = changesetDisplayStatus(changeset);

  if (status === "expired") {
    return { ok: false, error: "That changeset expired after six hours. Ask for a fresh one." };
  }

  if (status !== "ready") {
    return {
      ok: false,
      error: `That changeset is ${status}; only a ready changeset can be reviewed.`,
    };
  }

  const { error: updateError } = await supabase
    .from("changeset_files")
    .update({ accepted: input.accepted })
    .eq("id", input.fileId)
    .eq("changeset_id", input.changesetId)
    .eq("owner", input.owner);

  if (updateError) return { ok: false, error: updateError.message };

  const { data: files, error: filesError } = await supabase
    .from("changeset_files")
    .select("path, proposed_content, accepted, error")
    .eq("changeset_id", input.changesetId);

  if (filesError) return { ok: false, error: filesError.message };

  const accepted = ((files ?? []) as Array<{
    path: string;
    proposed_content: string;
    accepted: boolean;
    error: string | null;
  }>).filter((file) => file.error === null && file.accepted);

  const contentHash = changesetContentHash(
    accepted.map((file) => ({ path: file.path, proposed: file.proposed_content }))
  );
  const signature = signChangeset(
    { changesetId: input.changesetId, baseSha: changeset.base_sha, contentHash },
    input.sealKey
  );

  const { error: signError } = await supabase
    .from("changesets")
    .update({ content_hash: contentHash, signature, status: "ready" })
    .eq("id", input.changesetId)
    .eq("owner", input.owner);

  if (signError) return { ok: false, error: signError.message };

  return { ok: true };
}

/**
 * The only approval path in this build.
 *
 * It re-derives the content hash from the rows as they are now and compares
 * both the hash and the signature before the status moves. It then stops: no
 * branch, commit or pull request exists in phase 5, and the card says so.
 */
export async function approveChangeset(
  supabase: Client,
  input: { changesetId: string; sealKey: string | null }
): Promise<{ ok: true } | Failure> {
  if (!input.sealKey) {
    return {
      ok: false,
      error: "GITHUB_TOKEN_KEY is not configured, so changesets cannot be verified.",
    };
  }

  const { data: row, error } = await supabase
    .from("changesets")
    .select("id, status, base_sha, expires_at, content_hash, signature")
    .eq("id", input.changesetId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "That changeset no longer exists." };

  const changeset = row as {
    id: string;
    status: ChangesetStatus;
    base_sha: string;
    expires_at: string;
    content_hash: string | null;
    signature: string | null;
  };
  const status = changesetDisplayStatus(changeset);

  if (status === "expired") {
    return { ok: false, error: "That changeset expired after six hours. Ask for a fresh one." };
  }

  if (status !== "ready") {
    return {
      ok: false,
      error: `That changeset is ${status}; only a ready changeset can be approved.`,
    };
  }

  const { data: files, error: filesError } = await supabase
    .from("changeset_files")
    .select("path, proposed_content, error")
    .eq("changeset_id", input.changesetId)
    .eq("accepted", true);

  if (filesError) return { ok: false, error: filesError.message };

  const accepted = ((files ?? []) as Array<{
    path: string;
    proposed_content: string;
    error: string | null;
  }>).filter((file) => file.error === null);

  if (accepted.length === 0) {
    return { ok: false, error: "No files are accepted, so there is nothing to approve." };
  }

  const contentHash = changesetContentHash(
    accepted.map((file) => ({ path: file.path, proposed: file.proposed_content }))
  );

  if (!changeset.content_hash || changeset.content_hash !== contentHash) {
    return {
      ok: false,
      error: "The stored content hash does not match these files. Ask for a fresh changeset.",
    };
  }

  if (
    !changeset.signature ||
    !verifyChangesetSignature(
      {
        changesetId: changeset.id,
        baseSha: changeset.base_sha,
        contentHash,
      },
      changeset.signature,
      input.sealKey
    )
  ) {
    return {
      ok: false,
      error: "The signature does not match this content. Ask for a fresh changeset.",
    };
  }

  const { error: updateError } = await supabase
    .from("changesets")
    .update({ status: "approved" })
    .eq("id", input.changesetId)
    .eq("status", "ready");

  if (updateError) return { ok: false, error: updateError.message };

  return { ok: true };
}

export async function loadChangesets(
  supabase: Client,
  chatId: string
): Promise<ReviewChangeset[]> {
  const { data: rows } = await supabase
    .from("changesets")
    .select("id, status, base_sha, repo_full_name, expires_at, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(MAX_REVIEW_CARDS);

  const changesets = (rows ?? []) as ChangesetRow[];
  if (changesets.length === 0) return [];

  const { data: files } = await supabase
    .from("changeset_files")
    .select(
      "id, changeset_id, path, mode, diff, additions, deletions, diff_truncated, accepted, error"
    )
    .in(
      "changeset_id",
      changesets.map((changeset) => changeset.id)
    )
    .order("path");

  const fileRows = (files ?? []) as ChangesetFileRow[];

  return changesets.map((changeset) => ({
    ...changeset,
    files: fileRows
      .filter((file) => file.changeset_id === changeset.id)
      .map((file) => ({
        ...file,
        additions: Number(file.additions),
        deletions: Number(file.deletions),
      })),
  }));
}
