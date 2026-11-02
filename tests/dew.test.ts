import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  DAILY_FREE_DEW,
  DEW_DUST_FLOOR,
  DEW_PER_HOUR,
  DEW_PRECISION,
  HOUR_SESSION_MS,
  INVITE_REWARD_DEW,
  LOW_BALANCE_DEW,
  MAX_INVITES_PER_ACCOUNT,
  PAID_DAILY_FREE_DEW,
  TIMEZONES,
  TOPUP_PACKS,
  TRIAL_DEW,
  dailyAllowance,
  formatDew,
  isLowBalance,
  normalizeTimezone,
  roundDew,
} from "../lib/dew";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function documented(label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = README.match(new RegExp(`^\\| ${escaped} \\| ([^|]+) \\|$`, "m"));
  return match ? match[1].trim() : null;
}

test("the documented Dew numbers are the exported constants", () => {
  expect(DEW_PER_HOUR).toBe(3);
  expect(HOUR_SESSION_MS).toBe(3_600_000);
  expect(DAILY_FREE_DEW).toBe(10);
  expect(PAID_DAILY_FREE_DEW).toBe(15);
  expect(TRIAL_DEW).toBe(5);
  expect(DEW_PRECISION).toBe(3);
  expect(DEW_DUST_FLOOR).toBe(0.05);
  expect(LOW_BALANCE_DEW).toBe(10);
  expect(INVITE_REWARD_DEW).toBe(5);
  expect(MAX_INVITES_PER_ACCOUNT).toBe(10);
});

test("the README table agrees with every constant", () => {
  expect(documented("Hour price")).toBe(String(DEW_PER_HOUR));
  expect(documented("Daily free allowance")).toBe(String(DAILY_FREE_DEW));
  expect(documented("Paid daily allowance")).toBe(String(PAID_DAILY_FREE_DEW));
  expect(documented("Trial credit")).toBe(String(TRIAL_DEW));
  expect(documented("Low-balance warning")).toBe(String(LOW_BALANCE_DEW));
  expect(documented("Precision (decimals)")).toBe(String(DEW_PRECISION));
  expect(documented("Dust floor")).toBe(String(DEW_DUST_FLOOR));
});

test("Dew is kept to three decimals and displayed without trailing zeros", () => {
  expect(roundDew(1.23456)).toBe(1.235);
  expect(formatDew(10)).toBe("10");
  expect(formatDew(2.5)).toBe("2.5");
  expect(formatDew(0.05)).toBe("0.05");
  expect(formatDew(0)).toBe("0");
});

test("the low-balance state is a named threshold", () => {
  expect(isLowBalance(9.999)).toBe(true);
  expect(isLowBalance(10)).toBe(false);
  expect(isLowBalance(12)).toBe(false);
});

test("the daily allowance depends on whether the account has paid", () => {
  expect(dailyAllowance(false)).toBe(DAILY_FREE_DEW);
  expect(dailyAllowance(true)).toBe(PAID_DAILY_FREE_DEW);
});

test("the activity timezones include the profile default and reject junk", () => {
  expect(TIMEZONES).toContain("Asia/Kuala_Lumpur");
  expect(normalizeTimezone("Europe/Berlin")).toBe("Europe/Berlin");
  expect(normalizeTimezone(" Mars/Olympus ")).toBeNull();
  expect(normalizeTimezone("")).toBeNull();
  expect(normalizeTimezone(undefined)).toBeNull();
});

test("top-up packs are positive and ordered", () => {
  expect(TOPUP_PACKS[0]).toBeGreaterThan(0);
  expect([...TOPUP_PACKS]).toEqual([...TOPUP_PACKS].sort((a, b) => a - b));
});

test("the charge gate runs before any provider request", () => {
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");

  const gate = route.indexOf("startDewSession(");
  const providerReady = route.indexOf("if (!providersConfigured())");
  const firstProviderCall = route.indexOf("streamCompletion({");

  expect(gate).toBeGreaterThan(-1);
  expect(gate).toBeLessThan(firstProviderCall);
  // A missing provider key must not cost an hour, so it is checked first.
  expect(providerReady).toBeLessThan(gate);
});
