import { expect, test } from "bun:test";

import {
  isAdminDomainEmail,
  isAllowlistedAdmin,
  isExactAdminEmail,
  isVerifiedAllowlistedAdmin,
  normalizeDomain,
} from "../lib/admin/allowlist";
import {
  PLANS,
  PLAN_IDS,
  paymentLink,
  planById,
} from "../lib/billing/plans";

const PAYMENT_LINK_FALLBACK = "https://sociabuzz.com/minetallestmc/tribe";


test("an exact allowlisted email matches case-insensitively", () => {
  const env = { ADMIN_EMAILS: " Boss@Example.com , second@example.com " };

  expect(isExactAdminEmail("boss@example.com", env)).toBe(true);
  expect(isExactAdminEmail("SECOND@example.com", env)).toBe(true);
  expect(isExactAdminEmail("nobody@example.com", env)).toBe(false);
  expect(isAllowlistedAdmin("boss@example.com", env)).toBe(true);
});

test("the domain allowlist matches the verified domain only", () => {
  const env = { ADMIN_EMAIL_DOMAIN: "@mycompany.com" };

  expect(isAdminDomainEmail("owner@mycompany.com", env)).toBe(true);
  expect(isAdminDomainEmail("owner@sub.mycompany.com", env)).toBe(false);
  expect(isAdminDomainEmail("owner@mycompany.com.evil.test", env)).toBe(false);
  expect(isAdminDomainEmail("owner@notmycompany.com", env)).toBe(false);
});

test("domains are normalized and several can be listed", () => {
  expect(normalizeDomain(" @MyCompany.com. ")).toBe("mycompany.com");

  const env = { ADMIN_EMAIL_DOMAIN: "mycompany.com, @studio.dev" };
  expect(isAdminDomainEmail("a@mycompany.com", env)).toBe(true);
  expect(isAdminDomainEmail("b@studio.dev", env)).toBe(true);
});

test("an unconfirmed address is never an operator, whatever it says", () => {
  const env = {
    ADMIN_EMAILS: "boss@example.com",
    ADMIN_EMAIL_DOMAIN: "mycompany.com",
  };

  expect(isVerifiedAllowlistedAdmin("boss@example.com", true, env)).toBe(true);
  expect(isVerifiedAllowlistedAdmin("owner@mycompany.com", true, env)).toBe(true);

  // Signup is open: typing an admin address is not owning the mailbox.
  expect(isVerifiedAllowlistedAdmin("boss@example.com", false, env)).toBe(false);
  expect(isVerifiedAllowlistedAdmin("owner@mycompany.com", false, env)).toBe(
    false
  );
});

test("an unset or empty allowlist allows nobody", () => {
  expect(isAllowlistedAdmin("boss@example.com", {})).toBe(false);
  expect(isAllowlistedAdmin("", { ADMIN_EMAILS: "" })).toBe(false);
  expect(isAllowlistedAdmin(null, { ADMIN_EMAILS: "boss@example.com" })).toBe(
    false
  );
  expect(isAdminDomainEmail("boss@example.com", { ADMIN_EMAIL_DOMAIN: "@" })).toBe(
    false
  );
});

test("plans are unique, priced and worth Dew", () => {
  expect(new Set(PLAN_IDS).size).toBe(PLANS.length);

  for (const plan of PLANS) {
    expect(plan.price).toBeGreaterThan(0);
    expect(plan.dew).toBeGreaterThan(0);
    expect(planById(plan.id)?.name).toBe(plan.name);
  }

  expect(planById("nonexistent")).toBeNull();
  expect(planById(null)).toBeNull();
});

test("the payment link falls back and refuses non-http values", () => {
  expect(paymentLink({})).toBe(PAYMENT_LINK_FALLBACK);
  expect(paymentLink({ PAYMENT_LINK: "javascript:alert(1)" })).toBe(
    PAYMENT_LINK_FALLBACK
  );
  expect(paymentLink({ PAYMENT_LINK: "not a url" })).toBe(PAYMENT_LINK_FALLBACK);
  expect(paymentLink({ PAYMENT_LINK: "https://example.com/tribe" })).toBe(
    "https://example.com/tribe"
  );
});
