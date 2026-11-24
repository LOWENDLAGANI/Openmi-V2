import { NextResponse } from "next/server";

import { readAdminAccess } from "@/lib/admin/access";
import { readPresenceSnapshot } from "@/lib/admin/presence";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Real-time presence snapshot for the /admin operations panel.
 *
 * Re-resolves admin access on every poll and returns 404 to non-admins so the
 * route never reveals its existence.
 */
export async function GET() {
  const access = await readAdminAccess();
  if (access.state !== "admin") return json({ error: "Not found." }, 404);

  const admin = supabaseAdmin();
  if (!admin) {
    return json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set." }, 503);
  }

  const snapshot = await readPresenceSnapshot(admin);
  return json({ snapshot, currentAdminId: access.userId });
}
