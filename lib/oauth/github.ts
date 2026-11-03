import "server-only";

import { GithubError } from "@/lib/github/read";
import { serverEnv } from "@/lib/env";

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

export const GITHUB_OAUTH_SCOPES = "repo";

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
  const site = serverEnv().siteUrl?.trim();
  const base = site && /^https?:\/\//.test(site) ? site : origin;
  return new URL("/auth/github/callback", base).toString();
}

export function authorizeUrl(state: string, redirectUri: string): string {
  const clientId = serverEnv().githubOauthClientId;

  if (!clientId) {
    throw new GithubError(
      "unavailable",
      "GITHUB_OAUTH_CLIENT_ID is not set, so the OAuth connect flow is off. Use a personal access token."
    );
  }

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", GITHUB_OAUTH_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
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
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.githubOauthClientId,
      client_secret: env.githubOauthClientSecret,
      code,
      redirect_uri: redirectUri,
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
