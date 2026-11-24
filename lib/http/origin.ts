/**
 * Same-origin check for mutating routes.
 *
 * A session cookie is not enough on its own: another origin can make the
 * browser send it. Mission routes start sandboxes and spend Credit, so they check
 * that the request came from this deployment before doing either.
 *
 * A missing `Origin` header is allowed because non-browser callers and some
 * same-origin requests omit it; the browser sends it on every cross-origin POST,
 * which is the case this has to catch.
 *
 * Two origins are accepted: the configured `NEXT_PUBLIC_SITE_URL`, and the host
 * that actually served this request. The second one is what keeps a preview
 * deployment working — the same build runs on localhost, on a preview URL and on
 * the custom domain, and one configured value is wrong on two of the three. It
 * is not a hole: a page on another site cannot set `Origin` to our host.
 */

function normaliseSiteUrl(siteUrl: string | null | undefined): string | null {
  const trimmed = (siteUrl ?? "").trim();
  if (trimmed.length === 0) return null;

  // A bare domain in the environment file is a common slip; treat it as https
  // instead of throwing and 403ing every request from the deployment itself.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

/** A host that is only ever served over http while developing. */
const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?$/i;

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/** The host that served this request, e.g. `openmi.vercel.app`. */
function requestHost(request: Request): string | null {
  const forwarded = firstHeaderValue(request.headers.get("x-forwarded-host"));
  if (forwarded) return forwarded;
  const host = firstHeaderValue(request.headers.get("host"));
  if (host) return host;

  try {
    return new URL(request.url).host;
  } catch {
    return null;
  }
}

/**
 * The origin a browser is actually on, for somewhere a URL has to be built.
 *
 * `new URL(request.url).origin` is not it: behind a proxy, or under `next dev
 * --hostname 0.0.0.0`, the request URL carries the address the app is bound to
 * (`http://0.0.0.0:3000`, `http://localhost:3000`) rather than the host in the
 * address bar. Redirecting there sends the browser to a host that is not this
 * deployment — which is how an OAuth callback ends up as "redirect URI not
 * allowed" and then a 404.
 *
 * The forwarded headers are what a proxy sets; `host` is the fallback; the
 * request URL only answers when neither is present. The scheme defaults to
 * https for anything that is not a loopback address, because a TLS-terminating
 * proxy can hand the app an `http` URL and every public deployment of this app
 * is https.
 */
export function requestOrigin(request: Request): string {
  const host = requestHost(request);

  if (!host) {
    try {
      return new URL(request.url).origin;
    } catch {
      return "http://localhost";
    }
  }

  const forwarded = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const scheme = forwarded
    ? forwarded.toLowerCase()
    : LOOPBACK_HOST.test(host)
      ? "http"
      : "https";

  return `${scheme}://${host}`;
}

export function isSameOrigin(
  request: Request,
  siteUrl: string | null | undefined = process.env.NEXT_PUBLIC_SITE_URL
): boolean {
  const origin = request.headers.get("origin");

  if (!origin) return true;

  let caller: URL;
  try {
    caller = new URL(origin);
  } catch {
    return false;
  }

  const configured = normaliseSiteUrl(siteUrl);

  // Nothing configured to compare against: no policy to enforce. This is the
  // state a fresh clone starts in, and it must still be able to sign in.
  if (configured === null) return true;

  if (caller.origin === configured) return true;

  // The deployment's own host. The scheme is ignored on purpose: a proxy that
  // terminates TLS can hand the app an `http` URL while the browser sent
  // `https`, and the host is the part a page cannot forge.
  const host = requestHost(request);
  if (host && host.toLowerCase() === caller.host.toLowerCase()) return true;

  return false;
}
