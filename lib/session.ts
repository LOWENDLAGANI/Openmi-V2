import "server-only";

import { redirect } from "next/navigation";

import { supabaseServer } from "./supabase/server";

export type Session =
  | { state: "unconfigured" }
  | { state: "signed-out" }
  | {
      state: "signed-in";
      supabase: NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;
      user: {
        id: string;
        email: string | undefined;
        /** True only when Supabase confirmed the mailbox, not merely typed it. */
        emailVerified: boolean;
      };
    };

/**
 * Resolves the session from the request cookie.
 *
 * `getUser()` is a network call to Supabase Auth rather than a cookie decode,
 * so a forged or expired cookie resolves to "signed-out" here — the middleware
 * only saves a paint, it never decides.
 *
 * `emailVerified` comes from the same call. It is carried separately from the
 * address because an address is a string somebody typed at signup: only the
 * confirmation is the auth server saying the mailbox is theirs. Every decision
 * that keys off an email — the admin allowlist first — reads both.
 */
export async function getSession(): Promise<Session> {
  const supabase = await supabaseServer();
  if (!supabase) return { state: "unconfigured" };

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { state: "signed-out" };

  // `email_confirmed_at` is set both by the confirmation link and by an OAuth
  // identity the provider already verified; `confirmed_at` is the older field
  // kept for accounts created before it was split.
  const emailVerified = Boolean(
    data.user.email_confirmed_at ?? data.user.confirmed_at
  );

  return {
    state: "signed-in",
    supabase,
    user: {
      id: data.user.id,
      email: data.user.email ?? undefined,
      emailVerified,
    },
  };
}

/** Redirects to sign-in, preserving where the visitor was going. */
export async function requireSession(nextPath = "/chat") {
  const session = await getSession();
  if (session.state === "signed-in") return session;

  redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}
