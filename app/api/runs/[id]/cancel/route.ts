import { NextResponse } from "next/server";

import { isSameOrigin } from "@/lib/http/origin";
import { killRun, readRunForReader } from "@/lib/runs/store";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cancels and terminates a live run.
 *
 * Sets `cancel_requested = true` so the worker aborts its in-flight LLM stream
 * and kills any running sandbox command immediately, and force-settles the row
 * if the worker does not respond within the grace window.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "That request came from another origin." },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }

  const { id } = await context.params;
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json(
      { error: "Sign in." },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const admin = supabaseAdmin();

  if (!admin) {
    return NextResponse.json(
      { error: "This deployment cannot cancel runs." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const run = await readRunForReader(session.supabase, id);

  if (!run) {
    return NextResponse.json(
      { error: "That run does not exist." },
      { status: 404, headers: { "cache-control": "no-store" } }
    );
  }

  if (run.status === "done" || run.status === "failed" || run.status === "blocked") {
    return NextResponse.json(
      { cancelled: false, status: run.status, error: "That run already finished." },
      { status: 409, headers: { "cache-control": "no-store" } }
    );
  }

  const result = await killRun(admin, id, session.user.id);

  return NextResponse.json(
    {
      cancelled: result.cancelled,
      forced: result.forced,
      status: result.status ?? run.status,
      message: result.cancelled
        ? "Run stopped."
        : "The run is no longer running.",
    },
    { headers: { "cache-control": "no-store" } }
  );
}
