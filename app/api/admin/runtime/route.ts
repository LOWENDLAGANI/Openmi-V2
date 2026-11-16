import { NextResponse } from "next/server";

import { readAdminAccess } from "@/lib/admin/access";
import {
  cleanupProbeSandboxes,
  probeSandbox,
  probeWorker,
  readRuntimeSnapshot,
  rememberProbe,
  type RuntimeActionResult,
} from "@/lib/admin/runtime";
import { isSameOrigin } from "@/lib/http/origin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** A cold sandbox plus its teardown can outlast a default route budget. */
export const maxDuration = 120;

/**
 * The operator's runtime tests.
 *
 * Every request re-resolves the admin role: the panel's origin is not an
 * authority, and a route that runs a sandbox is exactly the place somebody
 * would try to skip the check. A POST is also same-origin, because starting a
 * box spends the account's provider quota.
 *
 * GET is the monitor poll: database counters and the last stored test results,
 * with no provider call. POST is a deliberate press and is the only path that
 * touches E2B.
 */

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function isAdmin(): Promise<boolean> {
  const access = await readAdminAccess();
  return access.state === "admin";
}

export async function GET() {
  if (!(await isAdmin())) return json({ error: "Not found." }, 404);

  const admin = supabaseAdmin();
  if (!admin) {
    return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set." }, 503);
  }

  return json({ snapshot: await readRuntimeSnapshot(admin) });
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return json({ error: "Not found." }, 404);

  if (!isSameOrigin(request)) {
    return json({ error: "Cross-origin request refused." }, 403);
  }

  const admin = supabaseAdmin();
  if (!admin) {
    return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set." }, 503);
  }

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
  } | null;

  const action = typeof body?.action === "string" ? body.action : "";

  let result: RuntimeActionResult;

  if (action === "ping-worker") {
    result = await probeWorker();
    await rememberProbe(admin, "worker", result);
  } else if (action === "ping-sandbox") {
    result = await probeSandbox();
    await rememberProbe(admin, "sandbox", result);
  } else if (action === "cleanup-sandboxes") {
    result = await cleanupProbeSandboxes();
  } else {
    return json({ error: "Unknown action." }, 400);
  }

  return json({
    action,
    result,
    snapshot: await readRuntimeSnapshot(admin),
  });
}
