import { NextResponse, type NextRequest } from "next/server";

/**
 * A paint-saving gate, not an authorization decision.
 *
 * It checks that a Supabase session cookie is *present*, then lets the request
 * through. It cannot read the token, and it does not try to: every query below
 * this point runs under RLS with the user's own JWT, so a forged cookie gets a
 * shell with no data and `getUser()` sends it back to sign-in.
 *
 * The reason this works at all is that the session lives in an httpOnly cookie
 * (`@supabase/ssr`) instead of a bearer token held in JavaScript.
 */
export function middleware(request: NextRequest) {
  const hasSessionCookie = request.cookies
    .getAll()
    .some(
      (cookie) =>
        cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token")
    );

  if (hasSessionCookie) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(
    request.nextUrl.pathname + request.nextUrl.search
  )}`;

  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/chat/:path*",
    "/activity/:path*",
    "/pay/:path*",
    // A paint-saving redirect only. /admin decides the role on the server and
    // answers 404 to a signed-in visitor without it.
    "/admin/:path*",
  ],
};
