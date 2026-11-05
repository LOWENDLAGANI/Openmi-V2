import "server-only";

import {
  CHANGESET_TTL_MS,
  changesetContentHash,
  signChangeset,
} from "@/lib/changesets";
import { unifiedDiff } from "@/lib/diff";
import type { supabaseAdmin } from "@/lib/supabase/admin";

import type { CollectedFile } from "./store";

/**
 * A mission's work becomes a changeset the same way a turn's proposals do:
 * stored files, a content hash, an HMAC over the hash, then the existing review
 * card, approval, branch and pull request.
 *
 * The mission never pushes. What leaves the sandbox is a diff, and the signature
 * is what makes "the user reviewed this exact content" checkable later.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

export async function createMissionChangeset(
  admin: Admin,
  input: {
    owner: string;
    chatId: string;
    missionId: string;
    repo: string;
    baseSha: string;
    files: CollectedFile[];
    sealKey: string | null;
  }
): Promise<{ ok: true; id: string; files: number } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("changesets")
    .insert({
      owner: input.owner,
      chat_id: input.chatId,
      turn_id: null,
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

  const changesetId = String((data as { id: string }).id);

  const accepted: Array<{ path: string; proposed: string }> = [];

  for (const file of input.files) {
    const original = file.original ?? "";
    const diff = unifiedDiff(original, file.content);

    const { error: fileError } = await admin.from("changeset_files").insert({
      changeset_id: changesetId,
      owner: input.owner,
      path: file.path,
      mode: "write",
      original_content: file.original,
      proposed_content: file.content,
      diff: diff.text,
      additions: diff.additions,
      deletions: diff.deletions,
      diff_truncated: diff.truncated,
      accepted: true,
      error: null,
    });

    if (fileError) {
      return { ok: false, error: fileError.message };
    }

    accepted.push({ path: file.path, proposed: file.content });
  }

  const contentHash = changesetContentHash(accepted);
  const signature = input.sealKey
    ? signChangeset(
        { changesetId, baseSha: input.baseSha, contentHash },
        input.sealKey
      )
    : null;

  const { error: signError } = await admin
    .from("changesets")
    .update({
      content_hash: contentHash,
      signature,
      // Without a signing key the diff is still reviewable in principle but the
      // database refuses to call it ready, so the card says so.
      status: signature ? "ready" : "draft",
    })
    .eq("id", changesetId);

  if (signError) return { ok: false, error: signError.message };

  await admin
    .from("execution_runs")
    .update({ result_changeset_id: changesetId })
    .eq("id", input.missionId);

  return { ok: true, id: changesetId, files: accepted.length };
}
