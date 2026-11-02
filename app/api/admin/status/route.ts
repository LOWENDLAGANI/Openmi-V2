import { NextResponse } from "next/server";

import { readAdminAccess } from "@/lib/admin/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The only thing this tells the browser is whether the *current* session is an
 * admin. It never returns why, and the answer is never trusted by /admin —
 * that page resolves access again from scratch.
 */
export async function GET() {
  const access = await readAdminAccess();

  return NextResponse.json(
    {
      admin: access.state === "admin",
      state: access.state,
      via: access.state === "admin" ? access.via : null,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
