import { expect, test } from "bun:test";

import {
  GESTURE_IDLE,
  TAPS_TO_UNLOCK,
  TAP_WINDOW_MS,
  advanceGesture,
  type GestureState,
} from "../lib/admin/gesture";

/**
 * The gesture has to be reachable by a person clicking the logo, not just by a
 * test walking a table. Every case below taps the same spot on purpose: that is
 * what a reader does, and it is what the previous quadrant sequence refused.
 */

test("ten taps in a burst unlock on the tenth, whatever spot they hit", () => {
  let state: GestureState = GESTURE_IDLE;
  const unlocks: boolean[] = [];

  for (let index = 0; index < TAPS_TO_UNLOCK; index += 1) {
    const result = advanceGesture(state, 1_000 + index * 200);
    state = result.state;
    unlocks.push(result.unlocked);
  }

  expect(TAPS_TO_UNLOCK).toBe(10);
  expect(unlocks).toEqual(
    Array(TAPS_TO_UNLOCK - 1).fill(false).concat([true]),
  );
  // A reveal is one-shot: the recogniser goes back to idle.
  expect(state).toEqual(GESTURE_IDLE);
});

test("nine taps do not unlock and report one tap remaining", () => {
  let state: GestureState = GESTURE_IDLE;
  let result = { unlocked: false, remaining: 0 } as ReturnType<typeof advanceGesture>;

  for (let index = 0; index < TAPS_TO_UNLOCK - 1; index += 1) {
    result = advanceGesture(state, 1_000 + index * 100);
    state = result.state;
  }

  expect(result.unlocked).toBe(false);
  expect(result.remaining).toBe(1);
  expect(state.taps).toBe(TAPS_TO_UNLOCK - 1);
});

test("a gap longer than the window starts the count again", () => {
  let state: GestureState = GESTURE_IDLE;
  for (let index = 0; index < 5; index += 1) {
    state = advanceGesture(state, 1_000 + index * 100).state;
  }
  expect(state.taps).toBe(5);

  const afterGap = advanceGesture(state, 1_000 + 4 * 100 + TAP_WINDOW_MS + 1);
  expect(afterGap.unlocked).toBe(false);
  expect(afterGap.state.taps).toBe(1);
  expect(afterGap.remaining).toBe(9);
});

test("a tap exactly on the window edge still counts", () => {
  const first = advanceGesture(GESTURE_IDLE, 1_000);
  const edge = advanceGesture(first.state, 1_000 + TAP_WINDOW_MS);

  expect(edge.state.taps).toBe(2);
  expect(edge.unlocked).toBe(false);
});

test("a slow burst of five and five never reaches ten", () => {
  let state: GestureState = GESTURE_IDLE;
  for (let index = 0; index < 5; index += 1) {
    state = advanceGesture(state, 1_000 + index * 100).state;
  }
  for (let index = 0; index < 5; index += 1) {
    state = advanceGesture(state, 3_000 + index * 100).state;
  }

  expect(state.taps).toBe(5);
});

test("a clock that jumps backwards cannot extend a burst", () => {
  const first = advanceGesture(GESTURE_IDLE, 5_000);
  const backwards = advanceGesture(first.state, 4_000);

  expect(backwards.state.taps).toBe(1);
  expect(backwards.unlocked).toBe(false);
});
