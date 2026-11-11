import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  TEST_LOGIN_EMAIL_KEY,
  TEST_LOGIN_FLAG,
  TEST_LOGIN_PASSWORD_KEY,
  testLoginCredentials,
  testLoginEnabled,
} from "../lib/test-login";

const root = join(import.meta.dir, "..");

const valid = {
  [TEST_LOGIN_FLAG]: "on",
  [TEST_LOGIN_EMAIL_KEY]: "  tester@example.com ",
  [TEST_LOGIN_PASSWORD_KEY]: "correct horse battery",
};

test("the test sign-in is off unless the flag is explicitly on", () => {
  for (const value of [undefined, "", "0", "off", "false", "no"]) {
    expect(testLoginEnabled({ [TEST_LOGIN_FLAG]: value })).toBe(false);
    expect(
      testLoginCredentials({ ...valid, [TEST_LOGIN_FLAG]: value })
    ).toBeNull();
  }

  expect(testLoginEnabled({ [TEST_LOGIN_FLAG]: "on" })).toBe(true);
  expect(testLoginEnabled({ [TEST_LOGIN_FLAG]: "TRUE" })).toBe(true);
});

test("a turned-on flag without a complete account is still no bypass", () => {
  expect(testLoginCredentials({ [TEST_LOGIN_FLAG]: "on" })).toBeNull();

  expect(
    testLoginCredentials({
      [TEST_LOGIN_FLAG]: "on",
      [TEST_LOGIN_EMAIL_KEY]: "tester@example.com",
    })
  ).toBeNull();

  expect(
    testLoginCredentials({
      [TEST_LOGIN_FLAG]: "on",
      [TEST_LOGIN_PASSWORD_KEY]: "correct horse battery",
    })
  ).toBeNull();

  expect(
    testLoginCredentials({ ...valid, [TEST_LOGIN_EMAIL_KEY]: "not-an-email" })
  ).toBeNull();

  expect(
    testLoginCredentials({ ...valid, [TEST_LOGIN_PASSWORD_KEY]: "short" })
  ).toBeNull();
});

test("complete credentials are trimmed and returned only when enabled", () => {
  expect(testLoginCredentials(valid)).toEqual({
    email: "tester@example.com",
    password: "correct horse battery",
  });
});

test("the route answers 404 unless the bypass is configured", () => {
  const route = readFileSync(join(root, "app/test-login/route.ts"), "utf8");

  expect(route).toContain("testLoginCredentials()");
  expect(route).toContain("status: 404");
  expect(route).toContain("safeNextPath");

  // Credentials come from the server environment, never from the URL, so they
  // cannot land in a log line, a referrer or a browser history entry.
  expect(route).not.toContain('searchParams.get("email")');
  expect(route).not.toContain('searchParams.get("password")');
});
