import { NextResponse } from "next/server";

import { isSameOrigin } from "@/lib/http/origin";
import { findActiveRunForOwner, killRun } from "@/lib/runs/store";
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
 * Stops the active run for this chat (or the account's active run when `all`
 * is requested or no chatId is provided yet).
 *
 * Sets `cancel_requested = true` so the worker aborts its in-flight LLM stream
 * and SIGKILLs any running sandbox command immediately, then waits briefly for
 * clean partial-progress delivery before force-settling the row so the account
 * is never left locked on "already have a run in progress".
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

  const body = (await request.json().catch(() => null)) as
    | { chatId?: unknown; all?: unknown }
    | null;
  const chatId = typeof body?.chatId === "string" ? body.chatId : "";
  const all = body?.all === true;

  const admin = supabaseAdmin();

  if (!admin) return json({ error: "This deployment cannot stop a run." }, 503);

  const active = await findActiveRunForOwner(admin, session.user.id, {
    chatId: chatId.length > 0 ? chatId : null,
    fallbackToAny: all || chatId.length === 0,
  });

  if (!active) return json({ ok: true, cancelled: false }, 200);

  const result = await killRun(admin, active.id, session.user.id);

  return json(
    {
      ok: true,
      cancelled: result.cancelled,
      forced: result.forced,
      status: result.status,
      runId: active.id,
    },
    200
  );
}
