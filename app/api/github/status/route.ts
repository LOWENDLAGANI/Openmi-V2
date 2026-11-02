import { NextResponse } from "next/server";

import { readConnection } from "@/lib/github/token";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Connection status, and nothing else.
 *
 * The sealed token, the plaintext token and every prefix of it are absent by
 * construction: this response is built from a query that does not select the
 * sealed column, plus the last four characters stored beside it.
 */
export async function GET() {
  const headers = { "cache-control": "no-store" } as const;
  const session = await getSession();

  if (session.state === "signed-out") {
    return NextResponse.json({ error: "signed-out" }, { status: 401, headers });
  }

  if (session.state === "unconfigured") {
    return NextResponse.json(
      { error: "supabase-not-configured" },
      { status: 503, headers }
    );
  }

  const connection = await readConnection(session.supabase, session.user.id);

  return NextResponse.json(
    {
      connected: connection !== null,
      login: connection?.login ?? null,
      lastFour: connection?.lastFour ?? null,
      scopes: connection?.scopes ?? [],
    },
    { headers }
  );
}
