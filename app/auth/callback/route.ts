import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/http/next-path";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Completes magic-link and OAuth redirects. Not used by password sign-in, which
 * writes the session cookies directly, but it exists from phase 1 so enabling
 * email links later is a configuration change rather than a code change.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  // The intended destination normally arrives as `?next=`. Supabase drops that
  // query string when it is not on the redirect allow list, so Google (and any
  // other OAuth provider) round trips also stash it in an `openmi_next` cookie.
  let next = safeNextPath(url.searchParams.get("next"), url.origin);
  if (url.searchParams.get("next") === null) {
    const cookieNext = request.cookies.get("openmi_next")?.value;
    if (cookieNext) {
      try {
        next = safeNextPath(decodeURIComponent(cookieNext), url.origin);
      } catch {
        next = safeNextPath(null, url.origin);
      }
    }
  }

  if (code) {
    const supabase = await supabaseServer();
    await supabase?.auth.exchangeCodeForSession(code);
  }

  const response = NextResponse.redirect(new URL(next, url.origin));
  response.cookies.set("openmi_next", "", {
    httpOnly: false,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  return response;
}