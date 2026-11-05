/**
 * What a mission may spend, and how a goal gets a deadline.
 *
 * Pure on purpose: no database, no network, no `server-only`. The runner, the
 * card and the tests read the same numbers, so a cap cannot drift between the
 * thing that enforces it and the thing that describes it.
 *
 * The price is the verification rate — 0.05 Dew per started minute, an
 * execution hour costs the same as a chat hour — and only the reserve moves
 * with the mission's length.
 */

export type MissionAutonomy = "plan" | "act" | "ship";

/** One tick is one server invocation; inside a 300s ceiling, with room to write. */
export const MISSION_TICK_MS = 240_000;

/** Total commands a single mission may run. */
export const MISSION_MAX_COMMANDS = 200;

/** Model decisions across the whole mission, not per tick. */
export const MISSION_MAX_STEPS = 60;

/** Tokens across the whole mission. */
export const MISSION_MAX_TOKENS = 240_000;

/** Output kept from one command. A mission is a stream, not an archive. */
export const MISSION_MAX_OUTPUT_BYTES = 32_768;

/** One foreground command's ceiling. A hung command must not hang the mission. */
export const MISSION_FOREGROUND_MS = 120_000;

/** A backgrounded process outlives its call, never its mission. */
export const MISSION_BACKGROUND_MS = 300_000;

export const MISSION_DEFAULT_MINUTES = 20;
export const MISSION_HARD_MAX_MINUTES = 30;
export const MISSION_MIN_MINUTES = 1;

export const MISSION_DEW_PER_MINUTE = 0.05;

/** Two ticks with no action is a loop, not progress. */
export const MISSION_STALL_AFTER_EMPTY_TICKS = 2;

/** A mission with no tick for this long is shown as paused, not running. */
export const MISSION_IDLE_PAUSE_MS = 60_000;

export const MISSION_WORKDIR = "openmi-workspace";

export type MissionCaps = {
  minutes: number;
  commands: number;
  steps: number;
  tokens: number;
  outputBytes: number;
  foregroundMs: number;
  backgroundMs: number;
  reserveDew: number;
  tickMs: number;
};

function integerFrom(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The operator's ceiling, clamped so a mis-set env cannot buy an hour. */
export function missionMinutes(
  env: Record<string, string | undefined> = process.env
): number {
  const minutes = integerFrom(env.EXEC_MISSION_MINUTES, MISSION_DEFAULT_MINUTES);
  return Math.min(
    MISSION_HARD_MAX_MINUTES,
    Math.max(MISSION_MIN_MINUTES, minutes)
  );
}

export function roundDew(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Reserved before the sandbox exists; the unused part settles back. */
export function missionReserveDew(minutes: number): number {
  const bounded = Math.min(
    MISSION_HARD_MAX_MINUTES,
    Math.max(MISSION_MIN_MINUTES, Math.trunc(minutes))
  );

  return roundDew(bounded * MISSION_DEW_PER_MINUTE);
}

export function missionCaps(
  env: Record<string, string | undefined> = process.env
): MissionCaps {
  const minutes = missionMinutes(env);

  return {
    minutes,
    commands: MISSION_MAX_COMMANDS,
    steps: MISSION_MAX_STEPS,
    tokens: MISSION_MAX_TOKENS,
    outputBytes: MISSION_MAX_OUTPUT_BYTES,
    foregroundMs: MISSION_FOREGROUND_MS,
    backgroundMs: MISSION_BACKGROUND_MS,
    reserveDew: missionReserveDew(minutes),
    tickMs: MISSION_TICK_MS,
  };
}

/** The instant this mission must stop, as a timestamp the row can hold. */
export function missionDeadline(startedAt: number, minutes: number): string {
  return new Date(startedAt + minutes * 60_000).toISOString();
}

export function remainingMs(
  deadlineAt: string | null,
  now: number = Date.now()
): number {
  if (!deadlineAt) return 0;
  return Math.max(0, new Date(deadlineAt).getTime() - now);
}

export function missionExpired(
  deadlineAt: string | null,
  now: number = Date.now()
): boolean {
  return remainingMs(deadlineAt, now) === 0;
}

/**
 * Dew owed for a mission that lasted `ms`, rounded up to a started minute and
 * never above the reservation. A mission that never started a sandbox costs
 * nothing, because nothing ran.
 */
export function chargeMissionDuration(ms: number, minutes: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;

  const charged = roundDew(Math.ceil(ms / 60_000) * MISSION_DEW_PER_MINUTE);
  return Math.min(charged, missionReserveDew(minutes));
}

export function stalledAfter(emptyTicks: number): boolean {
  return emptyTicks >= MISSION_STALL_AFTER_EMPTY_TICKS;
}

/** Plan mode is a promise about the workspace, not a security boundary. */
export function autonomyWrites(autonomy: MissionAutonomy): boolean {
  return autonomy === "act" || autonomy === "ship";
}

/** "4m 12s" — card copy, never arithmetic. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";

  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds}s`;
}
