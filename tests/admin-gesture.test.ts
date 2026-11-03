import { expect, test } from "bun:test";

import {
  ADMIN_SEQUENCE,
  GESTURE_IDLE,
  advanceGesture,
  directionOf,
} from "../lib/admin/gesture";

test("a drag shorter than the minimum is not a swipe", () => {
  expect(directionOf(10, 10)).toBeNull();
  expect(directionOf(-30, 20)).toBeNull();
  expect(directionOf(0, 43)).toBeNull();
});

test("a drag resolves to its dominant axis", () => {
  expect(directionOf(0, -60)).toBe("up");
  expect(directionOf(0, 60)).toBe("down");
  expect(directionOf(-60, 0)).toBe("left");
  expect(directionOf(60, 0)).toBe("right");
  expect(directionOf(-80, 30)).toBe("left");
  expect(directionOf(20, 90)).toBe("down");
});

test("up, down, left, right, up, down, left, right, up, right unlocks after the tenth step", () => {
  let state = GESTURE_IDLE;
  const unlocks: boolean[] = [];

  ADMIN_SEQUENCE.forEach((direction, index) => {
    const result = advanceGesture(state, direction, 1_000 + index * 200);
    state = result.state;
    unlocks.push(result.unlocked);
  });

  expect(unlocks).toEqual([false, false, false, false, false, false, false, false, false, true]);
  expect(state).toEqual(GESTURE_IDLE);
});

test("a wrong step restarts the sequence", () => {
  const first = advanceGesture(GESTURE_IDLE, "up", 1_000);
  expect(first.state.progress).toBe(1);

  const wrong = advanceGesture(first.state, "left", 1_200);
  // "left" is not the next step and not the first, so nothing is retained.
  expect(wrong.state.progress).toBe(0);
  expect(wrong.unlocked).toBe(false);
});

test("a wrong step that is the opening swipe restarts from one", () => {
  const first = advanceGesture(GESTURE_IDLE, "up", 1_000);
  const second = advanceGesture(first.state, "right", 1_200);
  const again = advanceGesture(second.state, "up", 1_400);

  expect(again.state.progress).toBe(1);
  expect(again.unlocked).toBe(false);
});

test("a pause longer than the window forgets the progress", () => {
  const first = advanceGesture(GESTURE_IDLE, "up", 1_000);
  const late = advanceGesture(first.state, "down", 1_000 + 5_000);

  expect(late.state.progress).toBe(0);
});

test("the same step repeated does not advance", () => {
  const first = advanceGesture(GESTURE_IDLE, "up", 1_000);
  const repeated = advanceGesture(first.state, "up", 1_200);

  // "up" is sequence[0], so it restarts the sequence at one rather than
  // pretending to be step two.
  expect(repeated.state.progress).toBe(1);
});
