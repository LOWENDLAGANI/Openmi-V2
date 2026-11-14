import { NextResponse } from "next/server";

import { isSameOrigin } from "@/lib/http/origin";
import { readRunForReader, requestRunCancel } from "@/lib/runs/store";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cancellation is a flag, not a kill.
 *
 * The worker reads it at each step boundary and lets the tool in flight finish,
 * so an edit is never half-applied. The row is read through the reader's own
 * client first — a run that is not theirs is a 404, not a 403 with a hint.
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

  const cancelled = await requestRunCancel(admin, id, session.user.id);

  return NextResponse.json(
    {
      cancelled,
      status: cancelled ? "cancelled" : run.status,
      // The row keeps saying `running` until the worker reaches its next
      // boundary; the UI shows "cancelling" rather than pretending it stopped.
      message: cancelled
        ? "Cancellation requested. The current tool call is allowed to finish."
        : "The run is no longer running.",
    },
    { headers: { "cache-control": "no-store" } }
  );
}
