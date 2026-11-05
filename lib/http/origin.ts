/**
 * Same-origin check for mutating routes.
 *
 * A session cookie is not enough on its own: another origin can make the
 * browser send it. Mission routes start sandboxes and spend Dew, so they check
 * that the request came from this deployment before doing either.
 *
 * A missing `Origin` header is allowed because non-browser callers and some
 * same-origin requests omit it; the browser sends it on every cross-origin POST,
 * which is the case this has to catch.
 */
export function isSameOrigin(
  request: Request,
  siteUrl: string | null | undefined = process.env.NEXT_PUBLIC_SITE_URL
): boolean {
  const origin = request.headers.get("origin");

  if (!origin) return true;

  const allowed = (siteUrl ?? "").trim().replace(/\/+$/, "");
  if (allowed.length === 0) return true;

  try {
    return new URL(origin).origin === new URL(allowed).origin;
  } catch {
    return false;
  }
}
