import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { CHECKPOINT_LIST_LIMIT } from "./plan";

/**
 * Reads and writes for workspace versions.
 *
 * Service role only, and only after a route resolved the chat through the
 * caller's session. A checkpoint is written by the server that ran git, never
 * claimed by a browser.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

export type CheckpointRow = {
  id: string;
  chatId: string;
  owner: string;
  sandboxId: string;
  commitSha: string;
  label: string;
  turnId: string | null;
  filesChanged: number;
  source: "turn" | "manual";
  createdAt: string;
};

const COLUMNS =
  "id, chat_id, owner, sandbox_id, commit_sha, label, turn_id, files_changed, source, created_at";

function toRow(raw: Record<string, unknown>): CheckpointRow {
  return {
    id: String(raw.id),
    chatId: String(raw.chat_id),
    owner: String(raw.owner),
    sandboxId: String(raw.sandbox_id),
    commitSha: String(raw.commit_sha),
    label: String(raw.label),
    turnId: raw.turn_id ? String(raw.turn_id) : null,
    filesChanged: Number(raw.files_changed ?? 0),
    source: raw.source === "manual" ? "manual" : "turn",
    createdAt: String(raw.created_at),
  };
}

export async function listCheckpoints(
  admin: Admin,
  chatId: string,
  limit: number = CHECKPOINT_LIST_LIMIT
): Promise<CheckpointRow[]> {
  const { data } = await admin
    .from("sandbox_checkpoints")
    .select(COLUMNS)
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 50));

  return ((data ?? []) as Array<Record<string, unknown>>).map(toRow);
}

/**
 * Records one version. A duplicate commit sha is not an error: a turn that ends
 * twice after the same edit produced one version, and the second write adds
 * nothing.
 */
export async function insertCheckpoint(
  admin: Admin,
  input: {
    chatId: string;
    owner: string;
    sandboxId: string;
    commitSha: string;
    label: string;
    turnId: string | null;
    filesChanged: number;
    source: "turn" | "manual";
  }
): Promise<CheckpointRow | null> {
  const { data, error } = await admin
    .from("sandbox_checkpoints")
    .upsert(
      {
        chat_id: input.chatId,
        owner: input.owner,
        sandbox_id: input.sandboxId,
        commit_sha: input.commitSha,
        label: input.label,
        turn_id: input.turnId,
        files_changed: input.filesChanged,
        source: input.source,
      },
      { onConflict: "chat_id,commit_sha", ignoreDuplicates: true }
    )
    .select(COLUMNS)
    .maybeSingle();

  if (error) return null;
  return data ? toRow(data as Record<string, unknown>) : null;
}
