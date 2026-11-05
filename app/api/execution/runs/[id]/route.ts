import { NextResponse } from "next/server";

import { settleExecutionDew } from "@/lib/dew/store";
import { chargeForDuration } from "@/lib/execution/cost";
import { isTerminal } from "@/lib/execution/status";
import { readRunForOwner } from "@/lib/execution/store";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Cancelling a run.
 *
 * The row is the authority, so cancelling is a status change rather than an
 * attempt to kill a process: the runner checks the row between stages and the
 * sandbox has a TTL either way. A run already past its terminal state is not
 * rewritten — "you cancelled this" must not appear over a real result.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { id } = await params;
  const admin = supabaseAdmin();

  if (!admin) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503 }
    );
  }

  const run = await readRunForOwner(session.supabase, id);

  if (!run) {
    return NextResponse.json({ error: "That run no longer exists." }, { status: 404 });
  }

  if (isTerminal(run.status)) {
    return NextResponse.json({ cancelled: false, status: run.status });
  }

  // Cancelling settles immediately, with the same rule the runner uses: minutes
  // are charged only once a sandbox existed. The runner's own settlement is
  // idempotent, so whichever call lands second changes nothing.
  const elapsed = Math.max(0, Date.now() - new Date(run.started_at).getTime());
  const charged = run.sandbox_id ? chargeForDuration(elapsed) : 0;

  const settlement = await settleExecutionDew(
    admin,
    session.user.id,
    id,
    charged
  );

  // A settlement that could not be written is reported as zero rather than as
  // a charge the ledger does not contain.
  const settledDew = settlement.ok ? charged : 0;

  await admin
    .from("execution_runs")
    .update({
      status: "cancelled",
      ended_at: new Date().toISOString(),
      duration_ms: elapsed,
      charged_dew: settledDew,
      failure_code: null,
      failure_detail: null,
    })
    .eq("id", id)
    .eq("owner", session.user.id)
    .in("status", ["queued", "running"]);

  return NextResponse.json({ cancelled: true, chargedDew: settledDew });
}
