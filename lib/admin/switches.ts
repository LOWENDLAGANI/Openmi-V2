/**
 * The admin panel's kill switch.
 *
 * One variable, read on the server, at the moment access is decided:
 *
 *   OPENMI_ADMIN_PANEL=off   →  nobody is an admin on this deployment
 *   unset, blank, or anything else  →  the normal rules apply (default on)
 *
 * The point is the incident, not convenience: if an operator account is
 * compromised, flipping this in the host's environment and redeploying takes the
 * panel away from everyone — including whoever holds the role row and a valid
 * session. It cannot be re-enabled from inside the product, and the check runs
 * before the allowlist and before `is_admin()`, so no session, cookie, URL or
 * database role can outrank it.
 *
 * Like `autoWriteEnabled`, this is pure: no `server-only`, so a test can call it
 * with an object instead of mutating the process environment.
 *
 * What it does not do, stated plainly: an attacker who already holds an admin
 * JWT can still call the admin RPCs directly against PostgREST, because those
 * live in the database and an env var is not visible there. Full revocation also
 * removes the `admin_users` row — see README, "Turning the admin panel off".
 */

export type AdminEnv = { readonly [key: string]: string | undefined };

/** Values that mean off. Anything else is on, including a typo. */
const OFF = new Set(["off", "false", "0", "no", "disabled"]);

export function adminPanelEnabled(env: AdminEnv = process.env): boolean {
  const flag = (env.OPENMI_ADMIN_PANEL ?? "").trim().toLowerCase();

  // Unset and blank are the same thing: the panel works, as it always has. A
  // deployment that has never heard of this variable must not lose its admins.
  if (flag.length === 0) return true;

  return !OFF.has(flag);
}
