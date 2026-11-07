/**
 * A `next` value that stays on this origin.
 *
 * Checking only the first characters is not enough: URL normalization treats a
 * backslash as a slash for http(s), so `/\evil.com` passes a `//` check and
 * still resolves to another host. Comparing the resolved origin is the check
 * that survives normalization.
 */
export function safeNextPath(
  value: string | null | undefined,
  origin: string,
  fallback = "/chat"
): string {
  if (typeof value !== "string") return fallback;

  const raw = value.trim();
  if (raw.length === 0 || raw.length > 2_000) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;

  try {
    const target = new URL(raw, origin);
    if (target.origin !== origin) return fallback;
    if (!target.pathname.startsWith("/")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
