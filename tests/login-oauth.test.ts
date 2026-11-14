import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Google sign-in is one redirect and one hand-off, and both are easy to break
 * silently: a provider typo leaves the button looking finished but dead, and a
 * redirect that skips /auth/callback would land on a page with no session.
 */

const AUTH_FORM = readFileSync(
  new URL("../components/AuthForm.tsx", import.meta.url),
  "utf8"
);
const CALLBACK = readFileSync(
  new URL("../app/auth/callback/route.ts", import.meta.url),
  "utf8"
);

test("the sign-in form offers Google through the shared callback", () => {
  expect(AUTH_FORM).toContain('provider: "google"');
  expect(AUTH_FORM).toContain("/auth/callback?next=");
  expect(AUTH_FORM).toContain("Continue with Google");

  // Both tabs are the same component, so the provider is offered at sign-up
  // too — an OAuth sign-in creates the account when there is none.
  expect(AUTH_FORM).toContain('value === "signin" ? "Sign in" : "Create account"');
});

test("the callback exchanges the code for a session cookie", () => {
  expect(CALLBACK).toContain("exchangeCodeForSession(code)");
  expect(CALLBACK).toContain("safeNextPath");
});
