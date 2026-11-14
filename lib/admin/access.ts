import "server-only";

import { redirect } from "next/navigation";

import { isVerifiedAllowlistedAdmin } from "@/lib/admin/allowlist";
import { adminPanelEnabled } from "@/lib/admin/switches";
import { getSession } from "@/lib/session";

/**
 * Admin access is decided here, on the server, from two facts:
 *
 *   A) the signed-in email is on the ADMIN_EMAILS / ADMIN_EMAIL_DOMAIN list
 *      *and* Supabase has confirmed that mailbox, or
 *   B) `is_admin()` — a security-definer function over `public.admin_users` —
 *      says the account holds the admin role.
 *
 * Neither fact is taken from the request body. `getUser()` is a call to the
 * auth server, so a forged Supabase cookie resolves to "signed-out" rather than
 * to somebody else's email — and signup is open, so an unconfirmed address is a
 * claim, not an identity.
 *
 * Hiding the `/admin` link is a convenience. This module and the RLS-defying
 * SQL functions behind the panel are the actual gate: every admin action calls
 * `requireAdmin()` again, and the database re-checks `is_admin()` inside each
 * function.
 */

export type AdminAccess =
  | { state: "unconfigured" }
  | { state: "signed-out" }
  | { state: "forbidden"; email: string | null }
  | {
      state: "admin";
      email: string | null;
      userId: string;
      via: "allowlist" | "role";
    };

export async function readAdminAccess(): Promise<AdminAccess> {
  const session = await getSession();

  // Before a configuration claim is read, so a deployment that is not set up
  // can still reach /setup — but before any identity is trusted.
  if (session.state === "unconfigured") return { state: "unconfigured" };

  // The kill switch, and the reason it is here rather than in the page: every
  // surface that answers "is this person an admin?" funnels through this
  // function, and every admin action calls it again. When it says off, the
  // answer is the same one a stranger gets — `forbidden` — so the panel 404s,
  // the actions redirect, the status route says no, and nothing explains why.
  //
  // It deliberately runs before the allowlist and before `is_admin()`: a
  // compromised account still holding its row and a valid session is exactly
  // the case this exists for, so a database role must not be able to outrank an
  // operator flipping the deployment's environment.
  if (!adminPanelEnabled()) return { state: "forbidden", email: null };

  if (session.state === "signed-out") return { state: "signed-out" };

  const { user, supabase } = session;

  if (isVerifiedAllowlistedAdmin(user.email, user.emailVerified)) {
    return {
      state: "admin",
      email: user.email ?? null,
      userId: user.id,
      via: "allowlist",
    };
  }

  // The role is read through a security-definer function so the client never
  // needs (and never gets) a select policy on admin_users.
  const { data, error } = await supabase.rpc("is_admin");

  if (!error && data === true) {
    return {
      state: "admin",
      email: user.email ?? null,
      userId: user.id,
      via: "role",
    };
  }

  return { state: "forbidden", email: user.email ?? null };
}

/**
 * Resolves access for a page or a server action. A signed-out visitor is sent
 * to sign-in; an account without the role is not told the panel exists.
 */
export async function requireAdmin(): Promise<
  Extract<AdminAccess, { state: "admin" }>
> {
  const access = await readAdminAccess();

  if (access.state === "unconfigured") redirect("/setup");
  if (access.state === "signed-out") redirect("/login?next=%2Fadmin");
  if (access.state === "forbidden") redirect("/chat");

  return access;
}
