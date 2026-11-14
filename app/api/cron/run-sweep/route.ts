import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { reconcileRuns } from "@/lib/runs/worker";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reconciliation without a worker, for the deployments that run the queue on a
 * machine whose reboot schedule nobody controls.
 *
 * Two jobs, both idempotent: a run whose heartbeat stopped is marked failed and
 * gets a `run.error` event, and a sandbox labelled `kind=run` that no live row
 * points at is destroyed. It executes no agent work, so it is safe on a
 * schedule.
 */
function authorised(header: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length === 0) return false;

  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(header ?? "", "utf8");

  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";

  if (secret.length === 0) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set, so the sweep will not run." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  if (!authorised(request.headers.get("authorization"))) {
    return NextResponse.json(
      { error: "Not authorised." },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const admin = supabaseAdmin();

  if (!admin) {
    return NextResponse.json(
      { error: "The database is not configured." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const result = await reconcileRuns(admin);

  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
