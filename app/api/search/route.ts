import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import {
  MAX_QUERY_CHARS,
  MAX_RESULTS,
  MIN_QUERY_CHARS,
  escapeLike,
  snippetAround,
} from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * Search this account's chats and messages.
 *
 * RLS is the only authority over what is visible: the query runs with the
 * session client, so a row from another account is not "filtered out", it is
 * invisible to Postgres. The response is never cached, and the query is not
 * logged.
 */
function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

type ChatRow = { id: string; title: string; updated_at: string };
type MessageRow = { id: string; chat_id: string; content: string; created_at: string };

export async function GET(request: Request) {
  const session = await getSession();

  if (session.state === "unconfigured") {
    return json({ error: "Supabase is not configured on this deployment." }, 503);
  }

  if (session.state !== "signed-in") {
    return json({ error: "Sign in to search." }, 401);
  }

  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();

  if (query.length < MIN_QUERY_CHARS) {
    return json({ chats: [], messages: [] }, 200);
  }

  if (query.length > MAX_QUERY_CHARS) {
    return json({ error: `Search is capped at ${MAX_QUERY_CHARS} characters.` }, 400);
  }

  const pattern = `%${escapeLike(query)}%`;

  const [chatsResult, messagesResult] = await Promise.all([
    session.supabase
      .from("chats")
      .select("id, title, updated_at")
      .is("deleted_at", null)
      .ilike("title", pattern)
      .order("updated_at", { ascending: false })
      .limit(MAX_RESULTS),
    session.supabase
      .from("messages")
      .select("id, chat_id, content, created_at")
      .ilike("content", pattern)
      .order("created_at", { ascending: false })
      .limit(MAX_RESULTS),
  ]);

  if (chatsResult.error || messagesResult.error) {
    return json(
      { error: chatsResult.error?.message ?? messagesResult.error?.message ?? "Search failed." },
      500
    );
  }

  const chats = (chatsResult.data ?? []) as ChatRow[];
  const messageRows = (messagesResult.data ?? []) as MessageRow[];

  // Message rows carry a chat id only. The titles come from a second read so a
  // message in the trash (or in a chat this account cannot see) is dropped
  // rather than shown with an invented heading.
  const chatIds = [...new Set(messageRows.map((row) => row.chat_id))];
  const titles = new Map(chats.map((chat) => [chat.id, chat.title]));

  if (chatIds.length > 0) {
    const { data } = await session.supabase
      .from("chats")
      .select("id, title")
      .in("id", chatIds)
      .is("deleted_at", null);

    for (const row of (data ?? []) as Array<{ id: string; title: string }>) {
      titles.set(row.id, row.title);
    }
  }

  return json(
    {
      chats: chats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updated_at,
      })),
      messages: messageRows
        .filter((row) => titles.has(row.chat_id))
        .map((row) => ({
          id: row.id,
          chatId: row.chat_id,
          chatTitle: titles.get(row.chat_id) ?? "Chat",
          snippet: snippetAround(row.content, query),
          createdAt: row.created_at,
        })),
    },
    200
  );
}
