/**
 * Who counts as an operator, by email.
 *
 * Two variables, both server-only:
 *
 *   ADMIN_EMAILS         exact addresses, comma separated
 *   ADMIN_EMAIL_DOMAIN   one or more domains, "@mycompany.com" or "mycompany.com"
 *
 * The email compared here always comes from Supabase's `getUser()` — a Google
 * (or password) identity the auth server signed — never from a form field or a
 * header. Nothing in this module is exposed to the browser bundle.
 *
 * There is deliberately no wildcard: an empty value allows nobody, and a value
 * like "@" is ignored rather than matching every address.
 */

// `process.env` satisfies this index signature; a narrower object literal would
// not be assignable to it under TypeScript's weak-type rule.
export type AdminEnv = { readonly [key: string]: string | undefined };

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function splitEntries(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** `@mycompany.com`, `mycompany.com` and ` MyCompany.com ` all become one form. */
export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, "").replace(/\.+$/, "");
}

export function isExactAdminEmail(
  email: string | null | undefined,
  env: AdminEnv = process.env
): boolean {
  const candidate = normalizeEmail(email);
  if (candidate.length === 0) return false;

  return splitEntries(env.ADMIN_EMAILS).includes(candidate);
}

export function isAdminDomainEmail(
  email: string | null | undefined,
  env: AdminEnv = process.env
): boolean {
  const candidate = normalizeEmail(email);
  if (candidate.length === 0) return false;

  const at = candidate.lastIndexOf("@");
  if (at <= 0 || at === candidate.length - 1) return false;

  const domain = candidate.slice(at + 1);

  return splitEntries(env.ADMIN_EMAIL_DOMAIN).some((entry) => {
    const normalized = normalizeDomain(entry);
    // A suffix comparison would accept "boss@mycompany.com.evil.test"; the
    // domain has to be the whole thing after the last @.
    return normalized.length > 0 && domain === normalized;
  });
}

/** Requirement A: the verified Google address is on the operator list. */
export function isAllowlistedAdmin(
  email: string | null | undefined,
  env: AdminEnv = process.env
): boolean {
  return isExactAdminEmail(email, env) || isAdminDomainEmail(email, env);
}
