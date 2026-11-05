import { NextResponse } from "next/server";

import { readAdminAccess } from "@/lib/admin/access";
import { chatSandboxCounts } from "@/lib/execution/chat-env/store";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The only thing this tells the browser is whether the *current* session is an
 * admin. It never returns why, and the answer is never trusted by /admin —
 * that page resolves access again from scratch.
 *
 * The sandbox counts are the one operational number here: live and stopped
 * environments and how many are past their wipe deadline. They are read with
 * the service role, so they are only included for a verified admin.
 */
export async function GET() {
  const access = await readAdminAccess();

  const admin = access.state === "admin";
  const client = admin ? supabaseAdmin() : null;
  const sandboxes = client ? await chatSandboxCounts(client) : null;

  return NextResponse.json(
    {
      admin,
      state: access.state,
      via: access.state === "admin" ? access.via : null,
      sandboxes,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
