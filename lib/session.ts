import "server-only";

import { redirect } from "next/navigation";

import { supabaseServer } from "./supabase/server";

export type Session =
  | { state: "unconfigured" }
  | { state: "signed-out" }
  /**
   * A stopped account. It is not `signed-out`: the identity is real, the cookie
   * is valid, and the difference is what lets the pages say why instead of
   * looping through sign-in.
   */
  | { state: "banned"; reason: string | null; until: string | null }
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

  // A ban is read on every session resolve, which is the point: there is no
  // cached token, no claim and no page that can outlive it. The row is a
  // primary-key read on the session's own client, so RLS scopes it to the
  // account being checked.
  const { data: profile } = await supabase
    .from("profiles")
    .select("banned_at, ban_expires_at, ban_reason")
    .eq("id", data.user.id)
    .maybeSingle();

  const row = profile as
    | { banned_at?: string | null; ban_expires_at?: string | null; ban_reason?: string | null }
    | null;

  if (row?.banned_at) {
    const until = row.ban_expires_at ?? null;

    // An expired ban is over without an operator doing anything; the row is
    // left in place so the panel can still show that it happened.
    if (!until || new Date(until).getTime() > Date.now()) {
      return { state: "banned", reason: row.ban_reason ?? null, until };
    }
  }

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

  // Sending a banned account to sign-in would loop: the cookie is valid, so
  // signing in lands it right back here. The page explains the stop instead.
  if (session.state === "banned") redirect("/banned");

  redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}
