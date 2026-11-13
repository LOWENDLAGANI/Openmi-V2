import "server-only";

import { GithubError } from "@/lib/github/read";
import { serverEnv } from "@/lib/env";
import {
  GITHUB_OAUTH_SCOPES,
  OAUTH_CALLBACK_PATH,
  authorizeUrlFor,
  basicAuthHeader,
  grantRevokeUrl,
  oauthRedirectUriFrom,
  tokenRequestBody,
} from "@/lib/oauth/urls";

/**
 * GitHub OAuth App connect flow.
 *
 * The point is the same sealed token the paste-a-token form stores: this only
 * replaces the copy-paste with an authorisation redirect. The access token still
 * goes through `saveConnection`, so it is verified, sealed with AES-256-GCM and
 * never returned to the browser.
 *
 * This lives outside `lib/github/` on purpose: that directory is asserted to be
 * GET-only (tests/github-read.test.ts), and the token exchange is a POST.
 */

export { GITHUB_OAUTH_SCOPES, OAUTH_CALLBACK_PATH };

export const STATE_COOKIE = "openmi-gh-state";

export function oauthConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.githubOauthClientId && env.githubOauthClientSecret);
}

/**
 * The callback must be the same URL GitHub has registered, so it is derived from
 * the configured site URL rather than from whatever Host a request arrived with.
 * The request origin is only a development fallback.
 */
export function oauthRedirectUri(origin: string): string {
  return oauthRedirectUriFrom(serverEnv().siteUrl, origin);
}

export function authorizeUrl(state: string, redirectUri: string): string {
  const clientId = serverEnv().githubOauthClientId;

  if (!clientId) {
    throw new GithubError(
      "unavailable",
      "GITHUB_OAUTH_CLIENT_ID is not set, so the OAuth connect flow is off. Use a personal access token."
    );
  }

  return authorizeUrlFor(clientId, state, redirectUri);
}

type TokenPayload = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

/** Exchanges the one-time code for an access token. Never logs the response. */
export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<string> {
  const env = serverEnv();

  if (!env.githubOauthClientId || !env.githubOauthClientSecret) {
    throw new GithubError(
      "unavailable",
      "GitHub OAuth is not configured on this deployment."
    );
  }

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: tokenRequestBody({
      clientId: env.githubOauthClientId,
      clientSecret: env.githubOauthClientSecret,
      code,
      redirectUri,
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as TokenPayload | null;

  if (!response.ok || !payload?.access_token) {
    const reason =
      payload?.error_description ??
      payload?.error ??
      "GitHub did not return an access token.";
    throw new GithubError("unauthorized", reason);
  }

  return payload.access_token;
}

/**
 * Deletes this OAuth App's grant on the reader's account, so Openmi disappears
 * from github.com/settings/applications instead of lingering as an authorised
 * app with nothing left here that could revoke it.
 *
 * GitHub authenticates the app, not the reader, for this call. A 404 means the
 * grant was already gone, which is the state this exists to reach.
 */
export async function revokeGrant(token: string): Promise<void> {
  const env = serverEnv();

  if (!env.githubOauthClientId || !env.githubOauthClientSecret) {
    throw new GithubError(
      "unavailable",
      "GitHub OAuth is not configured, so the grant cannot be revoked."
    );
  }

  const response = await fetch(grantRevokeUrl(env.githubOauthClientId), {
    method: "DELETE",
    headers: {
      accept: "application/vnd.github+json",
      authorization: basicAuthHeader(
        env.githubOauthClientId,
        env.githubOauthClientSecret
      ),
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ access_token: token }),
    // A disconnect must finish even if GitHub is slow; the caller turns a
    // timeout into "deleted here, revoke failed" rather than hanging the click.
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (response.status === 204 || response.status === 404) return;

  throw new GithubError(
    "unavailable",
    "GitHub did not confirm that the authorisation was revoked."
  );
}
