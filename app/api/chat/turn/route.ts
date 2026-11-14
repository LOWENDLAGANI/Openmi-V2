import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether this chat still has a run being answered.
 *
 * The client polls this while it thinks work is happening elsewhere. It is what
 * makes "close the tab, come back" honest: the worker writes the answer, and the
 * transcript refreshes when the run settles instead of showing a question with
 * no reply forever.
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
    .from("runs")
    .select("id, status")
    .eq("chat_id", chatId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as { id?: string; status?: string } | null;

  return NextResponse.json(
    {
      running: Boolean(row?.id),
      turnId: row?.id ?? null,
      status: row?.status ?? null,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
