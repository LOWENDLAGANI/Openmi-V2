/**
 * Dew: the billing unit for one hour of chat.
 *
 * These numbers are the contract. README.md documents each one in a table and
 * tests/dew.test.ts fails if the table and the constants ever disagree.
 *
 * Dew precision is three decimals. The dust floor is the smallest amount worth
 * recording; every charge in this build is a whole number of Dew, so the floor
 * exists to keep future partial charges from producing invisible fractions.
 */

/**
 * The price of an hour on the default model, and on every built-in model today.
 *
 * An hour is priced per model, because the model is what the reader chooses:
 * `ModelCapability.dewPerHour` carries that price and `model_hour_dew` decides
 * it in the database, so the browser cannot ask for a cheaper hour. This value
 * is the default a custom entry without a price of its own falls back to.
 */
export const DEW_PER_HOUR = 2;
export const HOUR_SESSION_MS = 3_600_000;
export const DAILY_FREE_DEW = 6;
export const PAID_DAILY_FREE_DEW = 15;
export const TRIAL_DEW = 5;
export const DEW_PRECISION = 3;
export const DEW_DUST_FLOOR = 0.05;
export const LOW_BALANCE_DEW = 10;

export const INVITE_REWARD_DEW = 5;
export const MAX_INVITES_PER_ACCOUNT = 10;

/** Top-up sizes an operator can issue as a code. No card payment exists yet. */
export const TOPUP_PACKS = [20, 50, 100] as const;

/**
 * Timezones offered in the activity page. The profile column defaults to
 * Asia/Kuala_Lumpur, so it must be in this list.
 */
export const TIMEZONES = [
  "UTC",
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
] as const;

export type Timezone = (typeof TIMEZONES)[number];

export function normalizeTimezone(value: unknown): Timezone | null {
  if (typeof value !== "string") return null;
  const found = TIMEZONES.find((zone) => zone === value.trim());
  return found ?? null;
}

/** Three decimals, half-up, without floating-point dust. */
export function roundDew(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** A balance for display: 10, 2.5, 0.05 — never 10.000. */
export function formatDew(value: number): string {
  const rounded = roundDew(value);
  return rounded.toFixed(DEW_PRECISION).replace(/\.?0+$/, "") || "0";
}

export function isLowBalance(balance: number): boolean {
  return balance < LOW_BALANCE_DEW;
}

/** The daily allowance for an account, in Dew. */
export function dailyAllowance(hasPaid: boolean): number {
  return hasPaid ? PAID_DAILY_FREE_DEW : DAILY_FREE_DEW;
}
