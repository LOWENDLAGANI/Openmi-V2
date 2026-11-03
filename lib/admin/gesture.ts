/**
 * The hidden admin sequence.
 *
 * A swipe is a pointer movement past `SWIPE_MIN_PX` on its dominant axis. Each
 * step must arrive within `SWIPE_WINDOW_MS` of the previous one, so a sequence
 * left half-finished in the morning does not unlock the panel in the afternoon.
 *
 * This module is deliberately pure: no DOM, no React, no clock of its own. The
 * component passes the timestamp, which is what makes the recognizer testable
 * without a browser.
 */

export type Direction = "up" | "down" | "left" | "right";

export const ADMIN_SEQUENCE: readonly Direction[] = [
  "up",
  "down",
  "left",
  "right",
  "up",
  "down",
  "left",
  "right",
  "up",
  "right",
];

export const SWIPE_MIN_PX = 44;
export const SWIPE_WINDOW_MS = 900;

export type GestureState = {
  /** How many steps of the sequence are complete. */
  progress: number;
  /** When the last accepted swipe happened, in epoch milliseconds. */
  lastAt: number;
};

export const GESTURE_IDLE: GestureState = { progress: 0, lastAt: 0 };

/**
 * The direction of a drag, or null when it is too small to be a swipe. A drag
 * counts along its dominant axis only, so a diagonal does not satisfy two
 * steps.
 */
export function directionOf(
  dx: number,
  dy: number,
  min: number = SWIPE_MIN_PX
): Direction | null {
  const horizontal = Math.abs(dx);
  const vertical = Math.abs(dy);

  if (horizontal < min && vertical < min) return null;

  if (horizontal >= vertical) {
    if (horizontal < min) return null;
    return dx < 0 ? "left" : "right";
  }

  if (vertical < min) return null;
  return dy < 0 ? "up" : "down";
}

/**
 * Feeds one swipe into the recognizer.
 *
 * A swipe that is not the next step restarts the sequence, unless it is the
 * first step — that way a wrong turn followed by the opening swipe does not
 * throw away the attempt.
 */
export function advanceGesture(
  state: GestureState,
  direction: Direction,
  now: number,
  sequence: readonly Direction[] = ADMIN_SEQUENCE,
  windowMs: number = SWIPE_WINDOW_MS
): { state: GestureState; unlocked: boolean } {
  const fresh = state.lastAt === 0 || now - state.lastAt > windowMs;
  const progress = fresh ? 0 : state.progress;

  let next = 0;
  if (direction === sequence[progress]) {
    next = progress + 1;
  } else if (direction === sequence[0]) {
    next = 1;
  }

  if (next >= sequence.length) {
    return { state: { ...GESTURE_IDLE }, unlocked: true };
  }

  return { state: { progress: next, lastAt: now }, unlocked: false };
}
