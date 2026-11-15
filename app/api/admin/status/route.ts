import { NextResponse } from "next/server";

import { readAdminAccess } from "@/lib/admin/access";
import { sandboxFleet } from "@/lib/execution/accounts";
import { chatSandboxCounts } from "@/lib/execution/chat-env/store";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The only thing this tells the browser is whether the *current* session is an
 * admin. It never returns why, and the answer is never trusted by /admin —
 * that page resolves access again from scratch.
 *
 * The operational numbers are here for the admin panel's live section: the
 * sandbox counts, and the fleet — which E2B account is working, which is cooling
 * or set aside, and when each was last tried. Both are read with the service
 * role, so they are only included for a verified admin. Account rows carry labels
 * and timestamps; no key material exists in that table to leak.
 */
export async function GET() {
  const access = await readAdminAccess();

  const admin = access.state === "admin";
  const client = admin ? supabaseAdmin() : null;
  const [sandboxes, fleet] = client
    ? await Promise.all([chatSandboxCounts(client), sandboxFleet(client)])
    : [null, null];

  return NextResponse.json(
    {
      admin,
      state: access.state,
      via: access.state === "admin" ? access.via : null,
      sandboxes,
      fleet,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
