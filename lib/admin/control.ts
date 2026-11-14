import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { adminPanelEnabled } from "./switches";

/**
 * Mirrors `OPENMI_ADMIN_PANEL` into the database.
 *
 * The app-level check in `readAdminAccess()` covers every surface this
 * deployment serves. It does not cover a stolen admin token calling the admin
 * RPCs straight against PostgREST, because that request never reaches Next.js.
 * `admin_control` is the database's copy of the switch, and `is_admin()` reads
 * it, so the mirror is what closes that path.
 *
 * Called from `instrumentation.ts` once per process and again lazily from
 * `readAdminAccess()`. Both writes are conditional: the value is remembered in
 * the module, so a healthy instance writes at most once, and a failed attempt is
 * retried after a minute rather than on every admin request. A database that is
 * briefly unreachable must not lock an operator out of their own panel — the
 * local check already answers correctly on its own.
 */

const RETRY_MS = 60_000;

/** The last value this process confirmed, or null before the first write. */
let confirmed: boolean | null = null;
let attemptedAt = 0;

export async function syncAdminControl(): Promise<boolean> {
  const desired = !adminPanelEnabled();

  if (confirmed === desired) return true;
  if (Date.now() - attemptedAt < RETRY_MS) return false;

  attemptedAt = Date.now();

  const admin = supabaseAdmin();
  if (!admin) return false;

  const { error } = await admin.rpc("admin_set_disabled", {
    p_disabled: desired,
  });

  if (error) return false;

  confirmed = desired;
  return true;
}

/** Test seam: forget what this process has written. */
export function resetAdminControlSync(): void {
  confirmed = null;
  attemptedAt = 0;
}
