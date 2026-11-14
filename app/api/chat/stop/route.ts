import { NextResponse } from "next/server";

import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Stops the run answering this chat.
 *
 * The flag is written to Postgres, not to the process that received this
 * request: the run is owned by a worker somewhere else. The worker reads it at
 * the next step boundary, so a tool in flight finishes before the run stops —
 * a half-applied edit is worse than a slow stop.
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

  const admin = supabaseAdmin();

  if (!admin) return json({ error: "This deployment cannot stop a run." }, 503);

  // RLS scopes the read to this owner; the explicit owner filter on the cancel
  // call is the second check, so a policy regression is a no-op, not a leak.
  const { data } = await session.supabase
    .from("runs")
    .select("id")
    .eq("chat_id", chatId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const runId = data ? String((data as { id: string }).id) : null;

  if (!runId) return json({ ok: true, cancelled: false }, 200);

  const { error } = await admin.rpc("request_run_cancel", {
    p_run: runId,
    p_owner: session.user.id,
  });

  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, cancelled: true, runId }, 200);
}
