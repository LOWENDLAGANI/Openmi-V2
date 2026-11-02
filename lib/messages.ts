import "server-only";

import { supabaseServer } from "@/lib/supabase/server";

type Client = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

export type MessageRow = {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  seq: number;
  usage_tokens: number | null;
  created_at: string;
};

export const MAX_HISTORY_MESSAGES = 12;
export const MAX_HISTORY_CHARS = 24_000;

/**
 * Reads a transcript in sequence order.
 *
 * Not `created_at`: the sequence is the order the database assigned, and it is
 * the same order on every device.
 */
export async function listMessages(
  supabase: Client,
  chatId: string
): Promise<MessageRow[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, chat_id, role, content, model, seq, usage_tokens, created_at")
    .eq("chat_id", chatId)
    .order("seq", { ascending: true });

  if (error || !data) return [];
  return data as MessageRow[];
}

/**
 * Appends one message and returns the row with its assigned sequence.
 *
 * All writes go through the `append_message` function rather than an insert:
 * that function holds a lock on the chat row and is the only place a `seq` is
 * chosen, so two concurrent appends cannot collide.
 */
export async function appendMessage(
  supabase: Client,
  chatId: string,
  role: MessageRow["role"],
  content: string,
  model: string | null,
  tokens: number | null = null
): Promise<MessageRow | null> {
  const { data, error } = await supabase.rpc("append_message", {
    p_chat_id: chatId,
    p_role: role,
    p_content: content,
    p_model: model,
  });

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as MessageRow;

  if (tokens !== null) {
    // Usage is an estimate, and the column name says so. It is never shown as a
    // price or a bill.
    await supabase
      .from("messages")
      .update({ usage_tokens: tokens })
      .eq("id", row.id);
  }

  return row;
}

/** The tail of a transcript, trimmed by characters rather than by a guess. */
export function recentHistory(messages: MessageRow[]): MessageRow[] {
  const tail = messages.slice(-MAX_HISTORY_MESSAGES);
  let total = 0;
  const kept: MessageRow[] = [];

  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const message = tail[index];
    total += message.content.length;
    if (total > MAX_HISTORY_CHARS && kept.length > 0) break;
    kept.unshift(message);
  }

  return kept;
}
