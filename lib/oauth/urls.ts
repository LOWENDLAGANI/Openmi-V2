/**
 * The pieces of the GitHub OAuth connect flow that are pure string work.
 *
 * Kept apart from `lib/oauth/github.ts` so they can be read and tested without
 * `server-only` or a configured environment. Everything here takes its inputs
 * as arguments; nothing reads `process.env`.
 */

export const GITHUB_OAUTH_SCOPES = "repo";
export const OAUTH_CALLBACK_PATH = "/auth/github/callback";
export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_APPLICATIONS_URL = "https://api.github.com/applications";

/**
 * The callback is derived from the configured site URL so it matches the one
 * registered on the OAuth App. A bare domain is read as https, the same way
 * `lib/http/origin.ts` treats it; anything unparseable falls back to the origin
 * the request actually arrived on.
 */
export function oauthRedirectUriFrom(
  siteUrl: string | null | undefined,
  origin: string
): string {
  const trimmed = (siteUrl ?? "").trim();
  const base =
    trimmed.length === 0
      ? origin
      : /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;

  try {
    return new URL(OAUTH_CALLBACK_PATH, base).toString();
  } catch {
    return new URL(OAUTH_CALLBACK_PATH, origin).toString();
  }
}

/** The consent screen URL. The client secret never appears here. */
export function authorizeUrlFor(
  clientId: string,
  state: string,
  redirectUri: string
): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", GITHUB_OAUTH_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * GitHub's token endpoint reads form-encoded parameters, not JSON — a JSON body
 * is answered with 400 even when it is shaped correctly. `Accept:
 * application/json` only decides the response format.
 */
/** The endpoint that deletes this app's authorisation on one account. */
export function grantRevokeUrl(clientId: string): string {
  return `${GITHUB_APPLICATIONS_URL}/${encodeURIComponent(clientId)}/grant`;
}

/**
 * GitHub authenticates the app itself to revoke a grant; the reader's token is
 * the grant being deleted, not the caller's credential.
 */
export function basicAuthHeader(
  clientId: string,
  clientSecret: string
): string {
  const pair = `${clientId}:${clientSecret}`;
  return `Basic ${Buffer.from(pair, "utf8").toString("base64")}`;
}

export function tokenRequestBody(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): URLSearchParams {
  return new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
}
