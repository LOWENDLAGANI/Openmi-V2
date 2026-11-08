import "server-only";

import { getRepo } from "@/lib/github/read";
import { readToken } from "@/lib/github/token";
import { GithubWriteError, revertChangeset, type RevertFile } from "@/lib/github/write";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Undo, from the row to the revert commit.
 *
 * It is the second — and only other — path that writes the default branch, and
 * it is narrow on purpose: the changeset must belong to the signed-in account,
 * it must have been applied (a merge commit is the proof), and it must not have
 * been undone already. The files are restored to their content at the base the
 * suggestion was computed against; GitHub is only written through
 * `lib/github/write.ts`.
 */

type Client = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

export type UndoResult =
  | { ok: true; revertedCommitSha: string }
  | { ok: false; error: string };

type UndoRow = {
  id: string;
  status: string;
  repo_full_name: string;
  base_sha: string;
  merge_commit_sha: string | null;
  reverted_commit_sha: string | null;
};

export async function undoAppliedChangeset(
  supabase: Client,
  input: { changesetId: string; owner: string }
): Promise<UndoResult> {
  const { data, error } = await supabase
    .from("changesets")
    .select("id, status, repo_full_name, base_sha, merge_commit_sha, reverted_commit_sha")
    .eq("id", input.changesetId)
    .eq("owner", input.owner)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That change no longer exists." };

  const row = data as UndoRow;

  if (!row.merge_commit_sha) {
    return {
      ok: false,
      error: "That change has not been applied, so there is nothing to undo.",
    };
  }

  if (row.status === "reverted" || row.reverted_commit_sha) {
    return { ok: false, error: "That change was already undone." };
  }

  const { data: fileRows, error: fileError } = await supabase
    .from("changeset_files")
    .select("path, original_content, error, accepted")
    .eq("changeset_id", row.id)
    .eq("accepted", true);

  if (fileError) return { ok: false, error: fileError.message };

  const files: RevertFile[] = ((fileRows ?? []) as Array<{
    path: string;
    original_content: string | null;
    error: string | null;
  }>)
    .filter((file) => file.error === null)
    .map((file) => ({
      path: String(file.path),
      original: file.original_content === null ? null : String(file.original_content),
    }));

  if (files.length === 0) {
    return { ok: false, error: "There is nothing to undo." };
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

  if (!github) return { ok: false, error: "Connect GitHub before undoing a change." };

  try {
    const repo = await getRepo(github.token, row.repo_full_name);

    const reverted = await revertChangeset({
      token: github.token,
      repo: row.repo_full_name,
      defaultBranch: repo.defaultBranch,
      changesetId: row.id,
      files,
    });

    const { error: saveError } = await supabase
      .from("changesets")
      .update({
        status: "reverted",
        reverted_commit_sha: reverted.commitSha,
        failure: null,
      })
      .eq("id", row.id)
      .eq("owner", input.owner);

    if (saveError) {
      return {
        ok: false,
        error: `The change was undone, but the changeset could not be updated: ${saveError.message}`,
      };
    }

    return { ok: true, revertedCommitSha: reverted.commitSha };
  } catch (caught) {
    return {
      ok: false,
      error:
        caught instanceof GithubWriteError || caught instanceof Error
          ? caught.message
          : "GitHub did not answer.",
    };
  }
}
