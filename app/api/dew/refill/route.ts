import { NextResponse } from "next/server";

import { refillDailyDew } from "@/lib/dew/store";
import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * Settles the daily allowance on demand.
 *
 * The refill also runs when a page renders, but a tab can stay open across
 * midnight: the balance on screen was then yesterday's, and the charge dialog
 * refused an account the database would have topped up on the spot. Asking here
 * — at the moment a send is judged — is what keeps "Dew didn't renew" from
 * becoming a dead end that only a reload fixes.
 *
 * It is the same `refill_daily_dew` call every page makes: idempotent, capped by
 * the account's own local day, and it never mints Dew on a day that is ahead of
 * that date.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "That request came from another origin." },
      { status: 403, headers: NO_STORE }
    );
  }

  const session = await getSession();

  if (session.state === "unconfigured") {
    return NextResponse.json(
      { error: "Supabase is not configured on this deployment." },
      { status: 503, headers: NO_STORE }
    );
  }

  if (session.state !== "signed-in") {
    return NextResponse.json(
      { error: "Sign in to check your balance." },
      { status: 401, headers: NO_STORE }
    );
  }

  const settled = await refillDailyDew(session.supabase);

  // The function returns the balance, but the wallet is the other half of what a
  // charge can draw on, so both are read back. A failed refill is not an error
  // here: the account can still chat on what it already has.
  const { data } = await session.supabase
    .from("profiles")
    .select("dew_balance, wallet_dew")
    .eq("id", session.user.id)
    .maybeSingle();

  const row = (data ?? {}) as {
    dew_balance?: number | string;
    wallet_dew?: number | string;
  };

  return NextResponse.json(
    {
      balance: Number(row.dew_balance ?? settled ?? 0),
      wallet: Number(row.wallet_dew ?? 0),
      settled: settled !== null,
    },
    { headers: NO_STORE }
  );
}
