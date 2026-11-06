/**
 * What a sandbox minute costs, in Dew.
 *
 * The numbers here are the contract the same way `lib/dew.ts` is: a test reads
 * them, and the plan in `docs/EXECUTION_ENVIRONMENT_PLAN.md` is expected to
 * agree. The charge is per started minute, reserved up front and settled on the
 * wall time the run actually recorded.
 *
 * Where 0.05 comes from, written down so it can be re-derived instead of
 * trusted:
 *
 *   - the provider bills €0.045 per vCPU-hour plus €0.015 per GiB-hour, per
 *     second, on the size that was allocated (orkestr's published sandbox
 *     rates);
 *   - the default size is `medium` (2 vCPU / 4 GiB), so an awake hour is
 *     2 × €0.045 + 4 × €0.015 = €0.150. Their own worked example agrees: 333
 *     medium sandbox-hours is quoted at about €50;
 *   - the plan floor is RM 0.75 per Dew and a chat hour is 3 Dew (RM 2.25), so
 *     an execution hour is priced at the same 3 Dew as a chat hour — RM 2.25
 *     against roughly RM 0.75 of compute.
 *
 * That is 3 Dew an hour, or 0.05 a started minute. It was re-checked when the
 * provider changed and did not move: the previous 2 vCPU / 4 GiB box was
 * $0.1659 an hour, within a few percent of €0.150, so the size the rate assumes
 * and the price it produces are both still right. A different `EXECUTION_SIZE`
 * does re-open it — `large` is €0.30 an hour, twice this one.
 *
 * Not in this rate: a parked sandbox meters as snapshot storage rather than
 * compute, and the first 10 GB of held storage is free on every plan. A chat
 * workspace that sits idle therefore costs storage, not minutes — which is the
 * behaviour the idle stop exists to produce. Egress is metered separately too.
 */

import { roundDew } from "@/lib/dew";

/** Charged per started minute of sandbox wall time. */
export const EXEC_DEW_PER_MINUTE = 0.05;

/** The smallest charge: a run that starts is charged for one minute. */
export const EXEC_MIN_CHARGE_DEW = 0.05;

/** A run that has not finished by this point is stopped and reported as such. */
export const EXEC_MAX_MINUTES = 10;

/** Reserved before the sandbox exists, refunded to the second. */
export const EXEC_RESERVE_DEW = roundDew(EXEC_DEW_PER_MINUTE * EXEC_MAX_MINUTES);

/**
 * Dew owed for a run that lasted `ms`, rounded up to a started minute and
 * never above the reserve. Zero-length runs cost nothing: a sandbox that never
 * started did not run.
 */
export function chargeForDuration(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;

  const minutes = Math.ceil(ms / 60_000);
  const charged = roundDew(minutes * EXEC_DEW_PER_MINUTE);

  return Math.min(charged, EXEC_RESERVE_DEW);
}

/** "2m 14s" — used in card copy, never in arithmetic. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";

  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}
