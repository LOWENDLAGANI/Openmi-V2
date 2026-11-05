import { NextResponse, type NextRequest } from "next/server";

import { describeGithubError } from "@/lib/github/read";
import { saveConnection } from "@/lib/github/token";
import {
  STATE_COOKIE,
  exchangeCode,
  oauthConfigured,
  oauthRedirectUri,
} from "@/lib/oauth/github";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function back(request: NextRequest, query: string) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL(`/chat?${query}`, url.origin));
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
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
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.redirect(new URL("/login?next=%2Fchat", url.origin));
  }

  if (!oauthConfigured()) {
    return failure(request, "GitHub sign-in is unavailable right now.");
  }

  if (url.searchParams.get("error")) {
    return failure(
      request,
      url.searchParams.get("error_description") ??
        "GitHub authorisation was cancelled."
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = request.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !expected || state !== expected) {
    return failure(
      request,
      "That GitHub sign-in could not be verified. Start the connection again."
    );
  }

  try {
    const token = await exchangeCode(code, oauthRedirectUri(url.origin));
    const connection = await saveConnection(session.supabase, session.user.id, token);

    return back(request, `connected=${encodeURIComponent(connection.login)}`);
  } catch (error) {
    return failure(request, describeGithubError(error));
  }
}
