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
  TRIAL_DEW,
  TRIAL_GRANT_MAX_PER_IP,
  TRIAL_GRANT_WINDOW_HOURS,
  dailyAllowance,
  formatDew,
  formatHourRemaining,
  formatPassDate,
  formatPassRemaining,
  hourRemainingMs,
  isLowBalance,
  normalizeTimezone,
  roundDew,
} from "../lib/dew";
import { MODELS } from "../lib/models";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function documented(label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = README.match(new RegExp(`^\\| ${escaped} \\| ([^|]+) \\|$`, "m"));
  return match ? match[1].trim() : null;
}

test("the documented Dew numbers are the exported constants", () => {
  expect(DEW_PER_HOUR).toBe(3);
  expect(HOUR_SESSION_MS).toBe(3_600_000);
  expect(DAILY_FREE_DEW).toBe(6);
  expect(PAID_DAILY_FREE_DEW).toBe(15);
  expect(TRIAL_DEW).toBe(5);
  expect(DEW_PRECISION).toBe(3);
  expect(DEW_DUST_FLOOR).toBe(0.05);
  expect(LOW_BALANCE_DEW).toBe(10);
  expect(INVITE_REWARD_DEW).toBe(5);
  expect(MAX_INVITES_PER_ACCOUNT).toBe(10);
});

test("an hour is priced per model, and the database agrees with the catalogue", () => {
  // 041 is the current definition: it makes Auto free and prices DeepSeek at 3.
  // 025 introduced the function and 026 taught it Auto, so those two are history.
  const migration = readFileSync(
    new URL("../supabase/migrations/041_free_auto_pricing.sql", import.meta.url),
    "utf8"
  );

  for (const model of MODELS) {
    // The same number in both places, or the picker advertises a price the
    // charge does not use.
    expect(migration).toContain(`when '${model.id}' then ${model.dewPerHour}::numeric`);
    // Auto is the one free hour; every other catalogue entry charges the
    // documented price.
    expect(model.dewPerHour).toBe(model.id === "auto" ? 0 : DEW_PER_HOUR);
  }
});

test("the trial grant is one address per day, and the database agrees", () => {
  expect(TRIAL_GRANT_MAX_PER_IP).toBe(1);
  expect(TRIAL_GRANT_WINDOW_HOURS).toBe(24);

  const migration = readFileSync(
    new URL("../supabase/migrations/027_lazy_trial_dew.sql", import.meta.url),
    "utf8"
  );

  expect(migration).toContain(`v_amount numeric := ${TRIAL_DEW}`);
  expect(migration).toContain(`if v_recent >= ${TRIAL_GRANT_MAX_PER_IP} then`);
  expect(migration).toContain(`interval '${TRIAL_GRANT_WINDOW_HOURS} hours'`);

  // Signup no longer writes the trial row; only the first request does.
  const trigger = migration.slice(
    migration.indexOf("create or replace function public.handle_new_user"),
    migration.indexOf("create or replace function public.grant_trial_dew")
  );

  expect(trigger.length).toBeGreaterThan(0);
  expect(trigger).not.toContain("'trial'");
});

test("the deployed refill allowance matches the constants", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/014_six_dew_daily.sql", import.meta.url),
    "utf8"
  );

  expect(migration).toContain(
    `case when v_paid then ${PAID_DAILY_FREE_DEW} else ${DAILY_FREE_DEW} end`
  );
  expect(migration).toContain("(now() at time zone coalesce(v_tz, 'UTC'))::date");
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

test("the pass countdown says how long is left before the free tier returns", () => {
  const now = Date.parse("2026-11-13T10:00:00.000Z");

  expect(formatPassRemaining(null, now)).toBeNull();
  expect(formatPassRemaining("not a date", now)).toBeNull();
  expect(formatPassRemaining("2026-11-13T09:00:00.000Z", now)).toBe("ended");
  expect(formatPassRemaining("2026-11-13T10:30:00.000Z", now)).toBe(
    "less than an hour left"
  );
  expect(formatPassRemaining("2026-11-13T13:00:00.000Z", now)).toBe(
    "3 hours left"
  );
  expect(formatPassRemaining("2026-11-14T12:00:00.000Z", now)).toBe(
    "2 days left"
  );
  // A pass bought right now reads as its full length, not one day short.
  expect(formatPassRemaining("2026-11-28T10:00:00.000Z", now)).toBe(
    "15 days left"
  );
});

test("a pass ends on the member's date, not the UTC date", () => {
  const until = "2026-12-01T17:30:00.000Z";

  // 17:30 UTC is already 01:30 on the next day in Kuala Lumpur.
  expect(formatPassDate(until, "Asia/Kuala_Lumpur")).toBe("2026-12-02");
  expect(formatPassDate(until, "UTC")).toBe("2026-12-01");
  expect(formatPassDate(until, null)).toBe("2026-12-01");
  expect(formatPassDate(until, "Not/AZone")).toBe("2026-12-01");
  expect(formatPassDate(null, "UTC")).toBeNull();
  expect(formatPassDate("not a date", "UTC")).toBeNull();
});

test("the activity timezones include the profile default and reject junk", () => {
  expect(TIMEZONES).toContain("Asia/Kuala_Lumpur");
  expect(normalizeTimezone("Europe/Berlin")).toBe("Europe/Berlin");
  expect(normalizeTimezone(" Mars/Olympus ")).toBeNull();
  expect(normalizeTimezone("")).toBeNull();
  expect(normalizeTimezone(undefined)).toBeNull();
});

test("the paid benefits are the ones advertised", () => {
  const plans = readFileSync(new URL("../lib/billing/plans.ts", import.meta.url), "utf8");

  expect(plans).toContain("export const PAID_BENEFITS = [");
  // The allowance is a constant the daily refill implements, not a number typed
  // into the copy: the two lines below cannot drift apart.
  expect(plans).toContain(`${PAID_DAILY_FREE_DEW} Dew a day instead of ${DAILY_FREE_DEW}`);
  // Paid accounts get the free tier as well; nothing here promises a support
  // channel or any other benefit the app does not implement.
  expect(plans).toContain("Everything the free tier includes");
});

test("the hour countdown reads as time left, and never goes negative", () => {
  expect(formatHourRemaining(0)).toBe("00:00");
  expect(formatHourRemaining(1_000)).toBe("00:01");
  expect(formatHourRemaining(59_000)).toBe("00:59");
  expect(formatHourRemaining(61_000)).toBe("01:01");
  // A session that outlives its hour still reads as a time, not as 62:03.
  expect(formatHourRemaining(3_723_000)).toBe("1:02:03");
  expect(formatHourRemaining(-5_000)).toBe("00:00");
});

test("the hour clock measures from the server and never promises more than an hour", () => {
  const endsAt = "2026-11-07T11:00:00.000Z";

  expect(hourRemainingMs({ endsAt, serverNow: "2026-11-07T10:00:00.000Z" })).toBe(
    HOUR_SESSION_MS
  );

  // A device seven hours behind cannot turn a one-hour row into eight hours.
  expect(
    hourRemainingMs({
      endsAt: "2026-11-07T18:00:00.000Z",
      serverNow: "2026-11-07T10:00:00.000Z",
    })
  ).toBe(HOUR_SESSION_MS);

  expect(
    hourRemainingMs({
      endsAt,
      serverNow: "2026-11-07T10:30:00.000Z",
      elapsedMs: 60_000,
    })
  ).toBe(1_740_000);

  expect(hourRemainingMs({ endsAt, serverNow: "2026-11-07T11:30:00.000Z" })).toBe(0);
  expect(
    hourRemainingMs({ endsAt: "not a date", serverNow: "2026-11-07T10:00:00.000Z" })
  ).toBeNull();
});

test("the charge gate runs before any provider request", () => {
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");

  const gate = route.indexOf("await startDewSession(");
  const providerReady = route.indexOf("if (!providersConfigured())");
  const queued = route.indexOf("createRun(admin");

  expect(gate).toBeGreaterThan(-1);
  expect(queued).toBeGreaterThan(-1);

  // The model call lives in the worker now, so the queue is the last thing this
  // request can do; the charge gate has to come before it.
  expect(gate).toBeLessThan(queued);
  // A missing provider key must not cost an hour, so it is checked first.
  expect(providerReady).toBeLessThan(gate);
});
