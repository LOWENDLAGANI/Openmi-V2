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

  const oauthError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");
  let callbackError: string | null = oauthError;

  if (code && !callbackError) {
    const supabase = await supabaseServer();
    if (supabase) {
      const { error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(code);

      if (exchangeError) {
        callbackError = exchangeError.message;
      } else {
        const cookieRef = request.cookies.get("openmi_ref")?.value;
        if (cookieRef) {
          try {
            const decoded = decodeURIComponent(cookieRef).trim();
            if (/^[A-Za-z0-9_-]{3,32}$/.test(decoded)) {
              await supabase.rpc("claim_invite_code", { p_code: decoded });
            }
          } catch {
            // Best-effort attribution; never block sign-in.
          }
        }
      }
    }
  }

  const destination = new URL(next, url.origin);
  if (callbackError) {
    destination.searchParams.delete("saved");
    destination.searchParams.delete("connected");
    destination.searchParams.set("error", callbackError);
  }

  const response = NextResponse.redirect(destination);
  response.cookies.set("openmi_next", "", {
    httpOnly: false,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("openmi_ref", "", {
    httpOnly: false,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  return response;
}