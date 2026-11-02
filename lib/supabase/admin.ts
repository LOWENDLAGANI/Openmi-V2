import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * The only module allowed to touch the service-role key.
 *
 * Its jobs are deliberately boring: read migration status and answer health
 * probes. Any product query that uses this client would be a bug — the user's
 * own session and RLS are the authority for their data.
 *
 * `server-only` above makes an accidental client import a build error rather
 * than a leaked key.
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) return null;

  try {
    return createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    // A malformed URL is a configuration problem the setup page reports; it is
    // not a reason to fail a request that does not need the database.
    return null;
  }
}
