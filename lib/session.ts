import "server-only";

import { redirect } from "next/navigation";

import { supabaseServer } from "./supabase/server";

export type Session =
  | { state: "unconfigured" }
  | { state: "signed-out" }
  | {
      state: "signed-in";
      supabase: NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;
      user: { id: string; email: string | undefined };
    };

/**
 * Resolves the session from the request cookie.
 *
 * `getUser()` is a network call to Supabase Auth rather than a cookie decode,
 * so a forged or expired cookie resolves to "signed-out" here — the middleware
 * only saves a paint, it never decides.
 */
export async function getSession(): Promise<Session> {
  const supabase = await supabaseServer();
  if (!supabase) return { state: "unconfigured" };

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { state: "signed-out" };

  return {
    state: "signed-in",
    supabase,
    user: { id: data.user.id, email: data.user.email ?? undefined },
  };
}

/** Redirects to sign-in, preserving where the visitor was going. */
export async function requireSession(nextPath = "/chat") {
  const session = await getSession();
  if (session.state === "signed-in") return session;

  redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}
