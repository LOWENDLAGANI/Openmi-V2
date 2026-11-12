import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Reads and writes for chat previews.
 *
 * Service role only, and only after a route has resolved the chat through the
 * caller's own session: the browser never names a sandbox or a process, and it
 * never gets to say what state a preview is in. Everything here is derived from
 * `chat_id`.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

export type ChatPreviewState = "starting" | "ready" | "stopped" | "failed";

export type ChatPreviewRow = {
  id: string;
  chatId: string;
  owner: string;
  sandboxId: string;
  processId: string | null;
  port: number | null;
  command: string | null;
  url: string | null;
  state: ChatPreviewState;
  failureDetail: string | null;
  /** Why a limit stopped it; null for a manual stop or no run. */
  stopReason: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  lastHitAt: string | null;
};

const COLUMNS =
  "id, chat_id, owner, sandbox_id, process_id, port, command, url, state, failure_detail, stop_reason, started_at, stopped_at, last_hit_at";

function toRow(raw: Record<string, unknown>): ChatPreviewRow {
  return {
    id: String(raw.id),
    chatId: String(raw.chat_id),
    owner: String(raw.owner),
    sandboxId: String(raw.sandbox_id),
    processId: raw.process_id ? String(raw.process_id) : null,
    port: raw.port === null || raw.port === undefined ? null : Number(raw.port),
    command: raw.command ? String(raw.command) : null,
    url: raw.url ? String(raw.url) : null,
    state: raw.state as ChatPreviewState,
    failureDetail: raw.failure_detail ? String(raw.failure_detail) : null,
    stopReason: raw.stop_reason ? String(raw.stop_reason) : null,
    startedAt: raw.started_at ? String(raw.started_at) : null,
    stoppedAt: raw.stopped_at ? String(raw.stopped_at) : null,
    lastHitAt: raw.last_hit_at ? String(raw.last_hit_at) : null,
  };
}

export async function readChatPreview(
  admin: Admin,
  chatId: string
): Promise<ChatPreviewRow | null> {
  const { data } = await admin
    .from("chat_previews")
    .select(COLUMNS)
    .eq("chat_id", chatId)
    .maybeSingle();

  return data ? toRow(data as Record<string, unknown>) : null;
}

type PreviewWrite = {
  chatId: string;
  owner: string;
  sandboxId: string;
  state: ChatPreviewState;
  processId?: string | null;
  port?: number | null;
  command?: string | null;
  url?: string | null;
  failureDetail?: string | null;
  stopReason?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
};

/**
 * One row per chat, written with upsert.
 *
 * A start writes `starting` before the provider call, so a request that dies
 * mid-probe leaves a state the panel can show and the stop action can clear,
 * instead of a stopped chat that is somehow holding a port.
 */
export async function writeChatPreview(
  admin: Admin,
  input: PreviewWrite
): Promise<void> {
  const { error } = await admin.from("chat_previews").upsert(
    {
      chat_id: input.chatId,
      owner: input.owner,
      sandbox_id: input.sandboxId,
      state: input.state,
      process_id: input.processId ?? null,
      port: input.port ?? null,
      command: input.command ?? null,
      url: input.url ?? null,
      failure_detail: input.failureDetail ?? null,
      stop_reason: input.stopReason ?? null,
      started_at: input.startedAt ?? null,
      stopped_at: input.stoppedAt ?? null,
    },
    { onConflict: "chat_id" }
  );

  if (error) {
    // The preview still runs in the sandbox; only the record failed. Throwing
    // here would turn a working preview into a 500 the reader cannot explain.
    console.error("preview row could not be written:", error.message);
  }
}

/**
 * Records that somebody is looking at a ready preview.
 *
 * The idle stop measures attention, not traffic, so the panel touches this on
 * every poll. Only a ready row is touched: a stopped preview must not look
 * busy, and a failed one has nothing to keep alive.
 */
export async function touchChatPreview(
  admin: Admin,
  chatId: string
): Promise<void> {
  await admin
    .from("chat_previews")
    .update({ last_hit_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("state", "ready");
}
