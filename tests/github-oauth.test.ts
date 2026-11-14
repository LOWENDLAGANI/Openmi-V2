import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  GITHUB_OAUTH_SCOPES,
  OAUTH_CALLBACK_PATH,
  authorizeUrlFor,
  basicAuthHeader,
  grantRevokeUrl,
  oauthRedirectUriFrom,
  tokenRequestBody,
} from "../lib/oauth/urls";

const OAUTH = readFileSync(
  new URL("../lib/oauth/github.ts", import.meta.url),
  "utf8"
);
const CALLBACK = readFileSync(
  new URL("../app/auth/github/callback/route.ts", import.meta.url),
  "utf8"
);
const PANEL = readFileSync(new URL("../app/chat/page.tsx", import.meta.url), "utf8");
const ACTIONS = readFileSync(
  new URL("../app/github/actions.ts", import.meta.url),
  "utf8"
);
const TOKEN = readFileSync(
  new URL("../lib/github/token.ts", import.meta.url),
  "utf8"
);
const MIGRATION = readFileSync(
  new URL("../supabase/migrations/037_github_connection_via.sql", import.meta.url),
  "utf8"
);

const SECRET = "client-secret-never-in-a-url";

test("the consent URL carries the client id and state, never the client secret", () => {
  const redirectUri = "https://openmi.app/auth/github/callback";
  const url = new URL(authorizeUrlFor("client-123", "state-abc", redirectUri));

  expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
  expect(url.searchParams.get("client_id")).toBe("client-123");
  expect(url.searchParams.get("state")).toBe("state-abc");
  expect(url.searchParams.get("scope")).toBe(GITHUB_OAUTH_SCOPES);
  expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
  expect(url.toString()).not.toContain(SECRET);
});

test("the callback path is the one the README tells operators to register", () => {
  expect(OAUTH_CALLBACK_PATH).toBe("/auth/github/callback");
});

test("the callback URL comes from the configured site, not the request host", () => {
  expect(oauthRedirectUriFrom("https://openmi.app", "http://localhost:3000")).toBe(
    "https://openmi.app/auth/github/callback"
  );
});

test("a bare domain in the environment file is read as https", () => {
  expect(oauthRedirectUriFrom("openmi.app", "http://localhost:3000")).toBe(
    "https://openmi.app/auth/github/callback"
  );
});

test("a trailing slash does not double the callback path", () => {
  expect(oauthRedirectUriFrom("https://openmi.app/", "http://localhost:3000")).toBe(
    "https://openmi.app/auth/github/callback"
  );
});

test("an unset site URL falls back to the origin the request arrived on", () => {
  expect(oauthRedirectUriFrom(null, "http://localhost:3000")).toBe(
    "http://localhost:3000/auth/github/callback"
  );
  expect(oauthRedirectUriFrom("not a url", "http://localhost:3000")).toBe(
    "http://localhost:3000/auth/github/callback"
  );
});

test("the code exchange is form-encoded, because GitHub rejects a JSON body", () => {
  const redirectUri = "https://openmi.app/auth/github/callback";
  const body = tokenRequestBody({
    clientId: "client-123",
    clientSecret: SECRET,
    code: "code-abc",
    redirectUri,
  });

  expect(body).toBeInstanceOf(URLSearchParams);
  expect(body.get("client_id")).toBe("client-123");
  expect(body.get("client_secret")).toBe(SECRET);
  expect(body.get("code")).toBe("code-abc");
  expect(body.get("redirect_uri")).toBe(redirectUri);

  // GitHub answers a JSON token request with 400; this header is the fix. The
  // grant revoke below uses JSON on purpose — it is the REST API, not the
  // token endpoint — so the assertion is scoped to the exchange itself.
  const exchange = OAUTH.slice(
    OAUTH.indexOf("export async function exchangeCode"),
    OAUTH.indexOf("export async function revokeGrant")
  );

  expect(exchange).toContain('"content-type": "application/x-www-form-urlencoded"');
  expect(exchange).not.toContain('"content-type": "application/json"');
  expect(exchange).toContain("tokenRequestBody(");
});

test("nothing is stored until saveConnection has verified the token", () => {
  expect(CALLBACK).toContain("saveConnection(");
  expect(CALLBACK).not.toContain('.from("github_connections")');
});

test("the callback refuses a code that does not match the state cookie", () => {
  expect(CALLBACK).toContain("STATE_COOKIE");
  // Compared through a constant-time helper, so the response time does not say
  // which byte of the state differed.
  expect(CALLBACK).toContain("secretsMatch(state, expected)");
  expect(CALLBACK).not.toContain("state !== expected");
});

test("the connect panel leads with OAuth and keeps the token form as a fallback", () => {
  expect(PANEL).toContain('href="/auth/github"');
  expect(PANEL).toContain("Continue with GitHub");
  expect(PANEL).toContain("Use a personal access token instead");
  expect(PANEL).toContain("<details");
});

test("a grant is revoked with the app's own credentials, not the reader's", () => {
  expect(grantRevokeUrl("client-123")).toBe(
    "https://api.github.com/applications/client-123/grant"
  );

  const header = basicAuthHeader("client-123", SECRET);
  expect(header.startsWith("Basic ")).toBe(true);
  expect(Buffer.from(header.slice(6), "base64").toString("utf8")).toBe(
    `client-123:${SECRET}`
  );
  expect(grantRevokeUrl("client-123")).not.toContain(SECRET);
});

test("a client id cannot escape the grant URL", () => {
  expect(grantRevokeUrl("a/b")).toBe(
    "https://api.github.com/applications/a%2Fb/grant"
  );
});

test("disconnect revokes the grant only for an OAuth connection", () => {
  expect(ACTIONS).toContain("revokeGrant(");
  expect(ACTIONS).toContain('via === "oauth"');
  // A pasted token has no grant to delete, so the row still comes back first
  // and decides whether the revoke is attempted at all.
  expect(ACTIONS.indexOf("readToken(supabase, user.id)")).toBeLessThan(
    ACTIONS.indexOf("revokeGrant(github.token)")
  );
});

test("disconnect still deletes the row when GitHub will not revoke", () => {
  expect(ACTIONS).toContain("revokeFailed = true");
  expect(ACTIONS.indexOf('.delete()')).toBeGreaterThan(
    ACTIONS.indexOf("revokeGrant(github.token)")
  );
  expect(ACTIONS).toContain("github.com/settings/applications");
});

test("the callback records that this connection arrived through OAuth", () => {
  expect(CALLBACK).toContain('"oauth"');
  expect(CALLBACK).toMatch(/saveConnection\([\s\S]*?"oauth"\s*\)/);
});

test("the connection remembers which path stored it", () => {
  expect(TOKEN).toContain("connected_via");
  expect(TOKEN).toContain('via: "token" | "oauth"');
  expect(MIGRATION).toContain("add column if not exists");
  expect(MIGRATION).toContain("check (connected_via in ('token', 'oauth'))");
  expect(MIGRATION).toContain("default 'token'");
});
