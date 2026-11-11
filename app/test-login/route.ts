import { NextResponse } from "next/server";

import { safeNextPath } from "@/lib/http/next-path";
import { supabaseServer } from "@/lib/supabase/server";
import { testLoginCredentials } from "@/lib/test-login";

/**
 * Signs in the configured test account and lands on `next`.
 *
 * Off by default. With no flag, or an incomplete credential pair, this answers
 * 404 rather than explaining itself — a deployment that never opted in should
 * not advertise a sign-in door. Credentials are read from server env only; the
 * URL selects the destination and nothing else, so a password cannot end up in
 * a log line or a referrer.
 *
 * The session it writes is a normal Supabase session: RLS still decides every
 * row, and this route grants no privilege the account did not already have.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"), url.origin);

  const credentials = testLoginCredentials();
  if (!credentials) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await supabaseServer();
  if (!supabase) {
    return NextResponse.json(
      { error: "Accounts are not configured on this deployment." },
      { status: 503 }
    );
  }

  const { error } = await supabase.auth.signInWithPassword(credentials);

  if (error) {
    // The message names the failure without echoing the account or the reason
    // Supabase gave, which distinguishes "wrong password" from "does not exist"
    // to whoever can read this response.
    return NextResponse.json(
      {
        error:
          "The test account could not be signed in. Check that it exists and its email is confirmed.",
      },
      { status: 502 }
    );
  }

  return NextResponse.redirect(new URL(next, url.origin), { status: 303 });
}
