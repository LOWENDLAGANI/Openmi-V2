import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { safeNextPath } from "@/lib/http/next-path";
import { requestOrigin } from "@/lib/http/origin";
import {
  RETURN_COOKIE,
  STATE_COOKIE,
  authorizeUrl,
  oauthConfigured,
  oauthRedirectUri,
} from "@/lib/oauth/github";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Starts the GitHub OAuth connect flow for the signed-in reader.
 *
 * The state value is minted here, kept in an httpOnly cookie scoped to the
 * callback path, and compared in the callback. It is the only thing tying the
 * authorization code that comes back to the account that started it.
 */
export async function GET(request: Request) {
  // The browser's origin, not the address this process is bound to: the
  // redirect_uri below has to be the URL the reader is actually on, because
  // it is compared byte for byte with the OAuth App's registered callback.
  const origin = requestOrigin(request);
  const secure = origin.startsWith("https:");
  const url = new URL(request.url);
  const returnTo = safeNextPath(url.searchParams.get("next"), origin);
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(returnTo)}`, origin)
    );
  }

  // Each connect mints a state and sends a request to GitHub.
  const limited = await checkRateLimit(supabaseAdmin(), "oauth", session.user.id);
  if (!limited.allowed) {
    const dest = new URL(returnTo, origin);
    dest.searchParams.set(
      "error",
      `Too many GitHub connect attempts. Try again in ${limited.retryAfterSeconds} seconds.`
    );
    return NextResponse.redirect(dest);
  }

  if (!oauthConfigured()) {
    const dest = new URL(returnTo, origin);
    dest.searchParams.set(
      "error",
      "GitHub sign-in is unavailable right now. Connect with a personal access token instead."
    );
    return NextResponse.redirect(dest);
  }

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(
    authorizeUrl(state, oauthRedirectUri(origin))
  );

  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/auth/github",
    maxAge: 600,
  });

  response.cookies.set(RETURN_COOKIE, returnTo, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/auth/github",
    maxAge: 600,
  });

  return response;
}
