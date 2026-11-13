import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { adsAllowed, parseConsent } from "../lib/consent";

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const PRIVACY = read("/app/privacy/page.tsx");
const TERMS = read("/app/terms/page.tsx");
const LANDING = read("/app/page.tsx");
const ABOUT = read("/app/about/page.tsx");
const PAY = read("/app/pay/page.tsx");
const BANNER = read("/components/CookieConsent.tsx");
const SLOT = read("/components/AdSlot.tsx");
const GATE = read("/components/AdBlockGate.tsx");

/**
 * Copy that a visitor reads as a promise.
 *
 * These assertions are deliberately narrow: the numbers on the public pages
 * must come from the constants the product implements, the cookie list must
 * name the cookies the code actually sets, and a consent banner must be read by
 * the thing that would otherwise ignore it.
 */

test("the public pages take their prices from the constants", () => {
  for (const page of [LANDING, ABOUT]) {
    expect(page).toContain('from "@/lib/dew"');
  }

  // A hard-coded "2 Dew" would survive a price change and become a lie.
  expect(LANDING).toContain("{DEW_PER_HOUR}");
  expect(LANDING).toContain("{DAILY_FREE_DEW}");
  expect(ABOUT).toContain("{DEW_PER_HOUR}");
  expect(ABOUT).toContain("{PAID_DAILY_FREE_DEW}");
  expect(ABOUT).toContain("{TRIAL_DEW}");
  expect(ABOUT).toContain("{INVITE_REWARD_DEW}");

  // The terms quote the allowance too, rather than restating it by hand.
  expect(TERMS).toContain("DEW_PER_HOUR");
  expect(TERMS).toContain("PAID_DAILY_FREE_DEW");
});

test("the legal pages name the cookies and processors the code uses", () => {
  // The cookie set is small and fixed; a policy that omits one is incomplete.
  for (const cookie of [
    "sb-<project>-auth-token",
    "openmi-gh-state",
    "openmi-country",
    "openmi-theme",
    "openmi-cookie-consent",
  ]) {
    expect(PRIVACY).toContain(cookie);
  }

  // Model access goes through these two, and they receive prompts.
  expect(PRIVACY).toContain("OpenRouter");
  expect(PRIVACY).toContain("DeepSeek");
  expect(TERMS).toContain("OpenRouter");
  expect(TERMS).toContain("DeepSeek");
});

test("consent means only what the banner asked", () => {
  expect(parseConsent("accepted")).toBe("accepted");
  expect(parseConsent("declined")).toBe("declined");
  // Anything else is no answer at all, which must never load an ad.
  expect(parseConsent("yes")).toBeNull();
  expect(parseConsent("")).toBeNull();
  expect(parseConsent(null)).toBeNull();

  expect(adsAllowed("accepted")).toBe(true);
  expect(adsAllowed("declined")).toBe(false);
  expect(adsAllowed(null)).toBe(false);
});

test("the banner's answer is read where ads are served", () => {
  expect(BANNER).toContain("writeConsent(");
  expect(BANNER).toContain('from "@/lib/consent"');
  expect(BANNER).toContain("/privacy#cookies");

  // No frame is created without consent, so a decline makes no ad request.
  expect(SLOT).toContain("adsAllowed(consent)");
  expect(SLOT).toContain("config && mayLoad ?");
  // A reader who declined receives no ads, so the gate must not demand them.
  expect(GATE).toContain("adsConfigured && adsAllowed(consent)");
});

test("the paused checkout does not show a form that cannot be submitted", () => {
  // Checkout is closed by default: the upload form is not rendered, and the
  // empty state does not tell a reader to pay and upload. Opening it with
  // TOPUP_PAUSED=off keeps the same structure, just renders the form.
  expect(PAY).toContain("{!TOPUP_PAUSED && (");
  expect(PAY).toContain("Uploads are paused while checkout is being tested");
  expect(PAY).not.toContain("disabled={TOPUP_PAUSED}");
});
