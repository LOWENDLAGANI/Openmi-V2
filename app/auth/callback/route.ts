import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";

/**
 * Completes magic-link and OAuth redirects. Not used by password sign-in, which
 * writes the session cookies directly, but it exists from phase 1 so enabling
 * email links later is a configuration change rather than a code change.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") ?? "/chat";

  const next =
    requested.startsWith("/") && !requested.startsWith("//") ? requested : "/chat";

  if (code) {
    const supabase = await supabaseServer();
    await supabase?.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
