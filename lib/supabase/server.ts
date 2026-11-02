import "server-only";

import { cookies } from "next/headers";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";

/**
 * Server client bound to the request's cookies.
 *
 * The session lives in an httpOnly cookie rather than a bearer token in
 * JavaScript, which is what lets `middleware.ts` redirect a signed-out visitor
 * before paint. RLS is still the authority — a forged cookie reads nothing.
 */
export async function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      // Annotated rather than inferred: `createServerClient` has deprecated
      // overloads, so contextual typing of the cookie callbacks is unreliable.
      setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
        for (const { name, value, options } of cookiesToSet) {
          try {
            cookieStore.set(name, value, options);
          } catch {
            // Server Components cannot set cookies. The session is refreshed in
            // route handlers and middleware, so a failed write here is expected
            // and harmless rather than an error worth surfacing.
          }
        }
      },
    },
  });
}
