/**
 * Where a reader writes when something is wrong.
 *
 * The address is product copy, not deployment configuration: it is the same on
 * every origin, and every page that tells someone to contact us has to show the
 * same one. Keeping it here means a change is one edit, and a bounced address
 * is one place to fix rather than a search across the legal pages.
 */
export const SUPPORT_EMAIL = "support@openmi.space";

/**
 * A `mailto:` for that address, with the subject pre-filled when there is one.
 *
 * The subject is encoded because a `&` or a `#` in it would otherwise end the
 * address and produce a link that opens an inbox that does not exist.
 */
export function supportMailto(subject?: string): string {
  const base = `mailto:${SUPPORT_EMAIL}`;
  if (!subject) return base;
  return `${base}?subject=${encodeURIComponent(subject)}`;
}
