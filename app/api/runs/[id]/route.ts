import { NextResponse } from "next/server";

import { readRunSnapshot } from "@/lib/runs/snapshot";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The snapshot a reload starts from.
 *
 * `runs.status` is the only source of truth. The transcript, steps, tool calls
 * and artifacts are what the UI renders beside it; nothing here is derived from
 * what the browser believes happened.
 *
 * "Not yours" and "not found" are the same 404: the row is read through the
 * reader's own client, so RLS refuses it before any other query runs.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json(
      { error: "Sign in." },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const snapshot = await readRunSnapshot(session.supabase, id);

  if (!snapshot) {
    return NextResponse.json(
      { error: "That run does not exist." },
      { status: 404, headers: { "cache-control": "no-store" } }
    );
  }

  return NextResponse.json(snapshot, {
    headers: { "cache-control": "no-store" },
  });
}
