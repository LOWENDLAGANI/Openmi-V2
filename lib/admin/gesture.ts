/**
 * The hidden admin sequence.
 *
 * Each tap on the logo moves one step forward when it lands within the tap
 * window from the previous tap, so a ten-tap burst unlocks the panel. If there
 * is a gap longer than the window, or the same spot is hit twice in a row,
 * progress resets.
 *
 * This module is deliberately pure: no DOM, no React, no clock of its own. The
 * component passes the timestamp, which is what makes the recognizer testable
 * without a browser.
 */

export type AdminFingerprint = [number, number];

export const ADMIN_SEQUENCE: readonly AdminFingerprint[] = [
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
  [1, 1],
  [2, 2],
];

export const TAP_WINDOW_MS = 1000;

export type GestureState = {
  /** How many taps of the sequence are complete. */
  progress: number;
  /** When the last accepted tap happened, in epoch milliseconds. */
  lastAt: number;
  /** Where the last accepted tap landed, used to reject the same spot twice. */
  lastFinger: AdminFingerprint | null;
};

export const GESTURE_IDLE: GestureState = { progress: 0, lastAt: 0, lastFinger: null };

/**
 * Feeds one tap into the recognizer. A tap is accepted when it arrives within
 * `windowMs` of the previous one and lands on a different spot than the last
 * accepted tap.
 */
export function advanceGesture(
  state: GestureState,
  finger: AdminFingerprint,
  now: number,
  sequence: readonly AdminFingerprint[] = ADMIN_SEQUENCE,
  windowMs: number = TAP_WINDOW_MS
): { state: GestureState; unlocked: boolean } {
  const expired =
    state.lastAt === 0 ||
    state.lastFinger === null ||
    now - state.lastAt > windowMs;

  const repeated =
    state.lastFinger !== null &&
    finger[0] === state.lastFinger[0] &&
    finger[1] === state.lastFinger[1];

  const progress = expired || repeated ? 0 : state.progress;

  const next =
    finger[0] === sequence[progress][0] &&
    finger[1] === sequence[progress][1]
      ? progress + 1
      : 0;

  if (next >= sequence.length) {
    return { state: { ...GESTURE_IDLE }, unlocked: true };
  }

  return {
    state: {
      progress: next,
      lastAt: now,
      lastFinger: finger,
    },
    unlocked: false,
  };
}
