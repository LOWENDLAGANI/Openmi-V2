import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import {
  STATE_COOKIE,
  authorizeUrl,
  oauthConfigured,
  oauthRedirectUri,
} from "@/lib/oauth/github";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Starts the GitHub OAuth connect flow for the signed-in reader.
 *
 * The state value is minted here, kept in an httpOnly cookie scoped to the
 * callback path, and compared in the callback. It is the only thing tying the
 * authorization code that comes back to the account that started it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.redirect(
      new URL("/login?next=%2Fchat", url.origin)
    );
  }

  if (!oauthConfigured()) {
    return NextResponse.redirect(
      new URL(
        `/chat?error=${encodeURIComponent(
          "GitHub OAuth is not configured on this deployment. Connect with a personal access token instead."
        )}`,
        url.origin
      )
    );
  }

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(
    authorizeUrl(state, oauthRedirectUri(url.origin))
  );

  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/auth/github",
    maxAge: 600,
  });

  return response;
}
