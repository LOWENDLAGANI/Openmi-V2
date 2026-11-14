/**
 * Boot-time work that belongs to the process, not to a request.
 *
 * One job today: mirror the admin kill switch into the database before the
 * deployment starts answering. A stolen admin token calling the admin RPCs
 * directly never touches a route, so the mirror has to be written by something
 * other than the panel — this is that something. When an operator flips
 * `OPENMI_ADMIN_PANEL` and redeploys, the new instances run this on cold start
 * and Postgres starts refusing.
 *
 * Deliberately forgiving: a database that is unreachable during a rollout must
 * not take the whole deployment down, and the app-level check in
 * `readAdminAccess()` already enforces the switch for our own surfaces.
 *
 * The Edge runtime has no service-role client, so it skips this. `next build`
 * does not import this file; only a running server does.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { syncAdminControl } = await import("@/lib/admin/control");
    await syncAdminControl();
  } catch {
    // Best effort. The next admin request retries.
  }
}
