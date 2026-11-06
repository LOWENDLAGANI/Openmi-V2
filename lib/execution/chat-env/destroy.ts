import "server-only";

import { executionConfigured } from "@/lib/env";
import {
  attachSandbox,
  destroySandboxConfirmed,
} from "@/lib/execution/provider";
import { supabaseAdmin } from "@/lib/supabase/admin";

import { isLeaseLive } from "./lifecycle";
import {
  deleteChatSandboxRow,
  readChatSandbox,
  updateChatSandbox,
  type ChatSandboxRow,
} from "./store";

/**
 * Destructive chat actions and the containers behind them.
 *
 * Postgres cascades; the sandbox provider does not. Trashing a chat destroys the workspace it
 * was warming — restore gets a fresh seed — and purging destroys the container
 * inline. Both mark the row `wiping` with a deadline of now *before* the chat
 * row is touched, because `chat_id` is `on delete set null`: the row survives
 * the cascade and the sweep can finish a delete this request could not.
 *
 * Nothing here throws at the caller. A failed teardown must not turn "delete
 * this chat" into an error the user cannot act on; the row stays `wiping` and
 * the sweep retries, which is exactly what `wipe_attempts` is for.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

async function markWiping(
  admin: Admin,
  row: ChatSandboxRow,
  now: number
): Promise<void> {
  await updateChatSandbox(admin, row.id, {
    state: "wiping",
    lease_until: null,
    delete_after: new Date(now).toISOString(),
    stopped_at: row.stoppedAt ?? new Date(now).toISOString(),
  });
}

/**
 * Trash: release compute now, and let the sweep destroy the disk.
 *
 * A live lease is left alone — a turn is using the box — but the deadline is
 * already now, so the first sweep after the lease expires wipes it.
 */
export async function trashChatSandbox(chatId: string): Promise<void> {
  const admin = supabaseAdmin();
  if (!admin) return;

  const row = await readChatSandbox(admin, chatId);
  if (!row) return;

  const now = Date.now();
  await markWiping(admin, row, now);

  if (!executionConfigured() || isLeaseLive(row.leaseUntil, now)) return;

  try {
    const handle = await attachSandbox(row.sandboxId);
    await handle.stop({ force: false });
  } catch {
    // Missing is fine; the sweep will confirm and remove the row.
  }
}

/**
 * Purge: destroy the container before the chat row is deleted.
 *
 * If the provider delete fails, the row is left `wiping` and the cascade nulls
 * its `chat_id` rather than removing it, so the next sweep finds it.
 */
export async function wipeChatSandbox(chatId: string): Promise<void> {
  const admin = supabaseAdmin();
  if (!admin) return;

  const row = await readChatSandbox(admin, chatId);
  if (!row) return;

  await markWiping(admin, row, Date.now());

  if (!executionConfigured()) return;

  try {
    await destroySandboxConfirmed(row.sandboxId);
    await deleteChatSandboxRow(admin, row.id);
  } catch {
    // Kept for the sweep: the row outlives the chat, the container is retried.
  }
}

/** Empty-trash helper: one bounded pass over the chats being purged. */
export async function wipeChatSandboxes(chatIds: string[]): Promise<void> {
  for (const chatId of chatIds.slice(0, 50)) {
    await wipeChatSandbox(chatId);
  }
}
