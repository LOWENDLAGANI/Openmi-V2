/**
 * The hidden admin sequence.
 *
 * Ten taps on the mark, each within the tap window of the one before it. That
 * is the whole rule: a burst of ten taps opens the verification card, and a
 * gap longer than the window starts the count again.
 *
 * An earlier version required a fixed ten-step tour of the mark's quadrants,
 * with the same cell rejected twice in a row. On the real page that sequence
 * was not reachable by tapping the logo: the second column sits under the
 * wordmark, the centre of the mark always reads as the first cell, and one
 * repeated spot silently reset the count — so ten clicks on the logo never
 * unlocked anything. Position no longer matters; the burst does.
 *
 * This module is deliberately pure: no DOM, no React, no clock of its own. The
 * component passes the timestamp, which is what makes the recognizer testable
 * without a browser.
 *
 * The gesture grants nothing. `/admin` resolves the operator role on the server
 * from the verified email or the database role, and answers 404 to anyone else.
 */

export const TAPS_TO_UNLOCK = 10;
export const TAP_WINDOW_MS = 1000;

export type GestureState = {
  /** Consecutive taps of the current burst. */
  taps: number;
  /** When the last counted tap happened, in epoch milliseconds. */
  lastAt: number;
};

export const GESTURE_IDLE: GestureState = { taps: 0, lastAt: 0 };

/**
 * Feeds one tap into the recognizer. A tap extends the burst when it arrives
 * within `windowMs` of the previous one, and starts a new burst otherwise.
 */
export function advanceGesture(
  state: GestureState,
  now: number,
  windowMs: number = TAP_WINDOW_MS
): { state: GestureState; unlocked: boolean; remaining: number } {
  const continued =
    state.lastAt !== 0 && now >= state.lastAt && now - state.lastAt <= windowMs;

  const taps = continued ? state.taps + 1 : 1;

  if (taps >= TAPS_TO_UNLOCK) {
    // Unlock once, then forget everything: the card is a one-shot reveal and
    // the next burst has to be earned again.
    return { state: { ...GESTURE_IDLE }, unlocked: true, remaining: 0 };
  }

  return {
    state: { taps, lastAt: now },
    unlocked: false,
    remaining: TAPS_TO_UNLOCK - taps,
  };
}
