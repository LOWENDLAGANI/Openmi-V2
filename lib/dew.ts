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

/**
 * The trial grant: 5 Dew, once per account, and at most one paid trial per
 * address per day.
 *
 * It is paid on the first chat request rather than at signup, because the signup
 * trigger has no address to count — auth.users stores none. `grant_trial_dew`
 * in the database is the only place it is paid, and tests/dew.test.ts reads
 * both so the constant and the function cannot drift apart.
 */
export const TRIAL_GRANT_MAX_PER_IP = 1;
export const TRIAL_GRANT_WINDOW_HOURS = 24;
export const DEW_PRECISION = 3;
export const DEW_DUST_FLOOR = 0.05;
export const LOW_BALANCE_DEW = 10;

export const INVITE_REWARD_DEW = 5;
export const MAX_INVITES_PER_ACCOUNT = 10;

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

/**
 * Time left in a paid hour, as a clock rather than a count of seconds.
 *
 * `mm:ss` inside the hour and `h:mm:ss` past it, so a long session still reads
 * as a time. Negative input is the end of the hour, not an error: a countdown
 * that has run out says `00:00`.
 */
export function formatHourRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * How long the paid hour has left, measured from the server's clock.
 *
 * The subscription this fixes is a real one: a device whose clock is seven
 * hours behind turns "one hour left" into "eight hours left", because the old
 * countdown compared a server timestamp with `Date.now()` on the phone. The
 * server's own `now` is the reference here, and `elapsedMs` is a monotonic
 * client tick, so wall-clock skew cannot stretch the hour.
 *
 * The result is also capped at the hour the product sells. An expiry further
 * out than `HOUR_SESSION_MS` is a data or clock anomaly, not a second paid
 * hour, and the clock must not promise one.
 */
export function hourRemainingMs(input: {
  endsAt: string;
  serverNow: string;
  elapsedMs?: number;
  limitMs?: number;
}): number | null {
  const ends = Date.parse(input.endsAt);
  const base = Date.parse(input.serverNow);

  if (!Number.isFinite(ends) || !Number.isFinite(base)) return null;

  const elapsed = Number.isFinite(input.elapsedMs) ? Math.max(0, input.elapsedMs ?? 0) : 0;
  const limit = input.limitMs ?? HOUR_SESSION_MS;

  return Math.min(Math.max(0, limit), Math.max(0, ends - base - elapsed));
}

/** The daily allowance for an account, in Dew: 15 while a pass is active. */
export function dailyAllowance(paidActive: boolean): number {
  return paidActive ? PAID_DAILY_FREE_DEW : DAILY_FREE_DEW;
}

/**
 * The calendar date a pass ends, in the member's own timezone.
 *
 * A pass ending at 00:30 in Kuala Lumpur is still the previous day in UTC, and
 * the date a member reads should be their date. An unset or invalid zone falls
 * back to UTC rather than hiding the date.
 */
export function formatPassDate(
  until: string | null | undefined,
  timeZone: string | null | undefined
): string | null {
  if (!until) return null;

  const ends = new Date(until);
  if (Number.isNaN(ends.getTime())) return null;

  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ends);
  } catch {
    return ends.toISOString().slice(0, 10);
  }
}

/**
 * How long is left on a paid pass, as a sentence a reader can act on.
 *
 * Days while there is at least a day, hours inside the last day, and a plain
 * "ended" once it is past. Null means no pass was ever bought, or the stored
 * date is unreadable; the caller decides what to show for that.
 */
export function formatPassRemaining(
  until: string | null | undefined,
  now: number = Date.now()
): string | null {
  if (!until) return null;

  const ends = Date.parse(until);
  if (!Number.isFinite(ends)) return null;

  const ms = ends - now;
  if (ms <= 0) return "ended";

  const hour = 60 * 60 * 1000;
  if (ms < hour) return "less than an hour left";
  if (ms < 24 * hour) {
    const hours = Math.ceil(ms / hour);
    return `${hours} hour${hours === 1 ? "" : "s"} left`;
  }

  const days = Math.ceil(ms / (24 * hour));
  return `${days} day${days === 1 ? "" : "s"} left`;
}
