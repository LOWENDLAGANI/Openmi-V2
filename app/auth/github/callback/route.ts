import { NextResponse, type NextRequest } from "next/server";

import { secretsMatch } from "@/lib/crypto";
import { describeGithubError } from "@/lib/github/read";
import { saveConnection } from "@/lib/github/token";
import { requestOrigin } from "@/lib/http/origin";
import {
  STATE_COOKIE,
  exchangeCode,
  oauthConfigured,
  oauthRedirectUri,
} from "@/lib/oauth/github";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function back(request: NextRequest, query: string) {
  // Back to the host in the address bar. `request.url` here carries whatever
  // address the process is bound to, so redirecting to it would land the reader
  // on `http://localhost:3000` (or `0.0.0.0`) instead of their own domain.
  const origin = requestOrigin(request);
  const response = NextResponse.redirect(new URL(`/chat?${query}`, origin));
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https:"),
    path: "/auth/github",
    maxAge: 0,
  });
  return response;
}

function failure(request: NextRequest, message: string) {
  return back(request, `error=${encodeURIComponent(message)}`);
}

/**
 * Completes the GitHub OAuth connect flow.
 *
 * Everything that can go wrong is a message on /chat, not a stack trace: a
 * denied authorisation, a replayed callback (state mismatch), a missing key or a
 * token GitHub will not issue. Nothing is stored until `saveConnection` has
 * verified the token against GitHub.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.redirect(new URL("/login?next=%2Fchat", origin));
  }

  if (!oauthConfigured()) {
    return failure(request, "GitHub sign-in is unavailable right now.");
  }

  if (url.searchParams.get("error")) {
    const description =
      url.searchParams.get("error_description") ??
      "GitHub authorisation was cancelled.";

    // A mismatched callback is the one failure an operator fixes by copying a
    // string into GitHub, so the message carries the exact string this
    // deployment asked GitHub for.
    if (/redirect_uri/i.test(description)) {
      return failure(
        request,
        `${description} This deployment sent ${oauthRedirectUri(
          origin
        )} as its callback URL; register exactly that on the OAuth App, and check NEXT_PUBLIC_SITE_URL matches the domain you are on.`
      );
    }

    return failure(request, description);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = request.cookies.get(STATE_COOKIE)?.value;

  // Constant-time: the state is the CSRF token, so which byte differs is not
  // something this comparison should reveal.
  if (!code || !state || !expected || !secretsMatch(state, expected)) {
    return failure(
      request,
      "That GitHub sign-in could not be verified. Start the connection again."
    );
  }

  try {
    const token = await exchangeCode(code, oauthRedirectUri(origin));
    const connection = await saveConnection(
      session.supabase,
      session.user.id,
      token,
      "oauth"
    );

    return back(request, `connected=${encodeURIComponent(connection.login)}`);
  } catch (error) {
    return failure(request, describeGithubError(error));
  }
}
