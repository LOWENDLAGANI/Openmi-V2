/**
 * What a sandbox minute costs, in Dew.
 *
 * The numbers here are the contract the same way `lib/dew.ts` is: a test reads
 * them, and the plan in `docs/EXECUTION_ENVIRONMENT_PLAN.md` is expected to
 * agree. The charge is per started minute, reserved up front and settled on the
 * wall time the run actually recorded.
 *
 * The rate is set from Daytona's published compute rate for the default
 * 2 vCPU / 4 GiB sandbox ($0.1659 per hour) against the plan floor of RM 0.75
 * per Dew, which puts an execution hour at the same 3 Dew as a chat hour. It is
 * a price, not a measurement: if the spike says runs are longer, the reserve
 * moves, not the rate.
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
