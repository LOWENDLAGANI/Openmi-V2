import "server-only";

import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "@/lib/supabase/admin";

import type { ChatSandboxState } from "./lifecycle";

/**
 * Reads and writes for chat environments.
 *
 * The table is service-role only: the browser never names a sandbox, and it
 * never needs to. The resolver derives the row from `chat_id` after the request
 * has already proved the chat belongs to the session, then this module moves
 * the lifecycle fields.
 *
 * Every write here is conditional where it matters: a lease is claimed with a
 * single `update … where`, so two turns cannot both believe they hold the box.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

export type ChatSandboxRow = {
  id: string;
  chatId: string | null;
  owner: string;
  sandboxId: string;
  state: ChatSandboxState;
  repoFullName: string;
  baseSha: string;
  workspaceSeededAt: string | null;
  lastActiveAt: string;
  leaseUntil: string | null;
  stoppedAt: string | null;
  archivedAt: string | null;
  deleteAfter: string;
  wipeAttempts: number;
  failureCode: string | null;
  failureDetail: string | null;
  createdAt: string;
};

export type ChatSandboxPatch = {
  chat_id?: string | null;
  state?: ChatSandboxState;
  sandbox_id?: string;
  workspace_seeded_at?: string | null;
  last_active_at?: string;
  lease_until?: string | null;
  stopped_at?: string | null;
  archived_at?: string | null;
  delete_after?: string;
  wipe_attempts?: number;
  failure_code?: string | null;
  failure_detail?: string | null;
};

const COLUMNS =
  "id, chat_id, owner, sandbox_id, state, repo_full_name, base_sha, workspace_seeded_at, last_active_at, lease_until, stopped_at, archived_at, delete_after, wipe_attempts, failure_code, failure_detail, created_at";

function toRow(raw: Record<string, unknown>): ChatSandboxRow {
  return {
    id: String(raw.id),
    chatId: raw.chat_id ? String(raw.chat_id) : null,
    owner: String(raw.owner),
    sandboxId: String(raw.sandbox_id),
    state: raw.state as ChatSandboxState,
    repoFullName: String(raw.repo_full_name),
    baseSha: String(raw.base_sha),
    workspaceSeededAt: raw.workspace_seeded_at ? String(raw.workspace_seeded_at) : null,
    lastActiveAt: String(raw.last_active_at),
    leaseUntil: raw.lease_until ? String(raw.lease_until) : null,
    stoppedAt: raw.stopped_at ? String(raw.stopped_at) : null,
    archivedAt: raw.archived_at ? String(raw.archived_at) : null,
    deleteAfter: String(raw.delete_after),
    wipeAttempts: Number(raw.wipe_attempts ?? 0),
    failureCode: raw.failure_code ? String(raw.failure_code) : null,
    failureDetail: raw.failure_detail ? String(raw.failure_detail) : null,
    createdAt: String(raw.created_at),
  };
}

export async function readChatSandbox(
  admin: Admin,
  chatId: string
): Promise<ChatSandboxRow | null> {
  const { data } = await admin
    .from("chat_sandboxes")
    .select(COLUMNS)
    .eq("chat_id", chatId)
    .maybeSingle();

  return data ? toRow(data as Record<string, unknown>) : null;
}

export async function listOwnerChatSandboxes(
  admin: Admin,
  owner: string
): Promise<ChatSandboxRow[]> {
  const { data } = await admin
    .from("chat_sandboxes")
    .select(COLUMNS)
    .eq("owner", owner)
    .order("last_active_at", { ascending: false })
    .limit(50);

  return ((data ?? []) as Array<Record<string, unknown>>).map(toRow);
}

/**
 * Records the row before the workspace is seeded.
 *
 * The order is deliberate: a crash during a two-minute seed must leave a row
 * that names the container, or the provider keeps a box nobody can find.
 */
export async function insertChatSandbox(
  admin: Admin,
  input: {
    chatId: string;
    owner: string;
    sandboxId: string;
    repoFullName: string;
    baseSha: string;
    leaseUntil: string;
    deleteAfter: string;
  }
): Promise<ChatSandboxRow> {
  const { data, error } = await admin
    .from("chat_sandboxes")
    .insert({
      id: randomUUID(),
      chat_id: input.chatId,
      owner: input.owner,
      sandbox_id: input.sandboxId,
      state: "provisioning",
      repo_full_name: input.repoFullName,
      base_sha: input.baseSha,
      last_active_at: new Date().toISOString(),
      lease_until: input.leaseUntil,
      delete_after: input.deleteAfter,
    })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "The chat sandbox could not be recorded.");
  }

  return toRow(data as Record<string, unknown>);
}

export async function updateChatSandbox(
  admin: Admin,
  id: string,
  patch: ChatSandboxPatch
): Promise<void> {
  await admin.from("chat_sandboxes").update(patch).eq("id", id);
}

/**
 * Takes the lease, or returns null.
 *
 * A row whose lease has expired can be claimed; a live lease cannot. This is
 * the whole concurrency story between two tabs and two deployments: the
 * provider has no idea which turn owns a box, so the row has to.
 */
export async function claimChatSandbox(
  admin: Admin,
  input: { id: string; now: number; leaseUntil: string }
): Promise<ChatSandboxRow | null> {
  const nowIso = new Date(input.now).toISOString();

  const { data } = await admin
    .from("chat_sandboxes")
    .update({ lease_until: input.leaseUntil, last_active_at: nowIso })
    .eq("id", input.id)
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select(COLUMNS)
    .maybeSingle();

  return data ? toRow(data as Record<string, unknown>) : null;
}

/** Ends a turn's hold without destroying the disk. */
export async function releaseChatSandboxRow(
  admin: Admin,
  input: { id: string; lastActiveAt: string; deleteAfter: string }
): Promise<void> {
  await updateChatSandbox(admin, input.id, {
    state: "running",
    last_active_at: input.lastActiveAt,
    delete_after: input.deleteAfter,
    lease_until: null,
    stopped_at: null,
    failure_code: null,
    failure_detail: null,
  });
}

export async function markChatSandboxFailed(
  admin: Admin,
  id: string,
  failure: { code: string; detail: string }
): Promise<void> {
  await updateChatSandbox(admin, id, {
    state: "failed",
    lease_until: null,
    failure_code: failure.code.slice(0, 120),
    failure_detail: failure.detail.slice(0, 2_000),
  });
}

export async function deleteChatSandboxRow(admin: Admin, id: string): Promise<void> {
  await admin.from("chat_sandboxes").delete().eq("id", id);
}
