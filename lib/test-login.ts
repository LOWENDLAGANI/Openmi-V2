/**
 * A one-click sign-in for test deployments.
 *
 * Typing an email and a password into the form is the one step a browser-driving
 * reviewer cannot do from a URL. This gives it a URL: `/test-login` signs in a
 * fixed account and lands on the app, so a whole-app pass needs no copy-paste.
 *
 * It is not an auth bypass. The route calls `signInWithPassword` and the
 * resulting session is an ordinary Supabase session, so RLS still decides every
 * row. What it removes is the form, not the account.
 *
 * Three conditions keep it inert: the flag must be explicitly "on", both
 * credential variables must be present, and the email must look like one. Any
 * one of them missing means "no bypass", and the route answers 404 — the same
 * posture as the admin panel, which does not admit it exists to a stranger.
 *
 * This is a pre-release affordance. It must not be set on a public deployment:
 * anyone who learns the URL would be signed in as the test account.
 */

export const TEST_LOGIN_FLAG = "OPENMI_TEST_LOGIN";
export const TEST_LOGIN_EMAIL_KEY = "OPENMI_TEST_LOGIN_EMAIL";
export const TEST_LOGIN_PASSWORD_KEY = "OPENMI_TEST_LOGIN_PASSWORD";

/** The shortest password the sign-up form accepts. */
export const TEST_LOGIN_MIN_PASSWORD = 8;

export function testLoginEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const flag = (env[TEST_LOGIN_FLAG] ?? "").trim().toLowerCase();

  return flag === "on" || flag === "true" || flag === "1";
}

/**
 * The credentials the route may use, or `null` when the bypass is not fully
 * configured. Values are never returned when the flag is off, so a caller
 * cannot accidentally have them.
 */
export function testLoginCredentials(
  env: Record<string, string | undefined> = process.env
): { email: string; password: string } | null {
  if (!testLoginEnabled(env)) return null;

  const email = (env[TEST_LOGIN_EMAIL_KEY] ?? "").trim();
  const password = env[TEST_LOGIN_PASSWORD_KEY] ?? "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (password.length < TEST_LOGIN_MIN_PASSWORD) return null;

  return { email, password };
}
