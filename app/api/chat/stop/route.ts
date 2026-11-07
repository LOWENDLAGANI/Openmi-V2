import { NextResponse } from "next/server";

import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Stops the running turn for a chat.
 *
 * The flag is written to Postgres rather than to this process, because the
 * request that stopped the turn may be handled by a different instance than the
 * one running it. The runner polls the flag and aborts the provider call.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return json({ error: "That request came from another origin." }, 403);
  }

  const session = await getSession();

  if (session.state === "unconfigured") {
    return json({ error: "Supabase is not configured." }, 503);
  }

  if (session.state !== "signed-in") return json({ error: "Sign in to chat." }, 401);

  const body = (await request.json().catch(() => null)) as { chatId?: unknown } | null;
  const chatId = typeof body?.chatId === "string" ? body.chatId : "";

  if (chatId.length === 0) return json({ error: "A chat id is required." }, 400);

  // RLS scopes the update to this owner; the explicit owner filter makes the
  // intent readable and turns a policy regression into a no-op.
  // The flag is what the runner polls, and the status is what the workspace
  // polls. Both are written here because the runner may already be gone: a
  // closed tab ends the invocation, and the row would otherwise keep saying
  // "running" for its full 30-minute TTL — which is why a stopped chat still
  // showed "still working on the server" after a commit or a reload. If the
  // runner is alive it writes its partial answer over the same row.
  const { error } = await session.supabase
    .from("agent_turns")
    .update({
      cancel_requested: true,
      status: "done",
      finished_at: new Date().toISOString(),
    })
    .eq("chat_id", chatId)
    .eq("owner", session.user.id)
    .eq("status", "running");

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true }, 200);
}
