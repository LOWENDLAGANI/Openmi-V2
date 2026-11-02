import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether a chat still has a turn being answered.
 *
 * The client polls this while it thinks a turn is running. It is what makes
 * "close the tab, come back" honest: the answer is written by the server, and
 * the transcript refreshes when the turn finishes instead of showing a question
 * with no reply forever.
 */
export async function GET(request: Request) {
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json(
      { running: false },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const chatId = new URL(request.url).searchParams.get("chatId") ?? "";

  if (chatId.length === 0) {
    return NextResponse.json(
      { running: false },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const { data } = await session.supabase
    .from("agent_turns")
    .select("turn_id, status, expires_at")
    .eq("chat_id", chatId)
    .eq("status", "running")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json(
    {
      running: Boolean(data),
      turnId: data ? String((data as { turn_id: string }).turn_id) : null,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
