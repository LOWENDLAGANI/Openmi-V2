import { expect, test } from "bun:test";

import {
  ADMIN_SEQUENCE,
  GESTURE_IDLE,
  advanceGesture,
  type GestureState,
} from "../lib/admin/gesture";

test("10 taps in sequence unlock after the tenth", () => {
  let state: GestureState = GESTURE_IDLE;
  const unlocks: boolean[] = [];

  ADMIN_SEQUENCE.forEach((finger, index) => {
    const result = advanceGesture(state, finger, 1_000 + index * 200);
    state = result.state;
    unlocks.push(result.unlocked);
  });

  expect(unlocks).toEqual(
    Array(ADMIN_SEQUENCE.length - 1).fill(false).concat([true]),
  );
  expect(state).toEqual(GESTURE_IDLE);
});

test("a fresh tap uses the sequence regardless of the last accepted spot", () => {
  let state = advanceGesture(GESTURE_IDLE, ADMIN_SEQUENCE[0], 1000);
  // A later tap far outside the window is treated as fresh, not rejected by
  // the last accepted spot.
  const r = advanceGesture(state.state, ADMIN_SEQUENCE[1], 2_000);
  expect(r.state.progress).toBe(2);
  expect(r.unlocked).toBe(false);
});

test("a gap longer than the window forgets progress", () => {
  let state = advanceGesture(GESTURE_IDLE, ADMIN_SEQUENCE[0], 1_000);
  expect(state.state.progress).toBe(1);
  expect(state.unlocked).toBe(false);

  state = advanceGesture(state.state, ADMIN_SEQUENCE[1], 1_000 + 2_000);
  expect(state.state.progress).toBe(0);
  expect(state.unlocked).toBe(false);
});

test("the same finger twice in a row does not count", () => {
  let r = advanceGesture(GESTURE_IDLE, ADMIN_SEQUENCE[0], 1000);
  expect(r.state.progress).toBe(1);

  // Repeating the first spot counts as a wasted tap, not as step two.
  r = advanceGesture(r.state, ADMIN_SEQUENCE[0], 1050);
  expect(r.state.progress).toBe(1);
  expect(r.unlocked).toBe(false);
});

test("an early tap on the wrong spot resets the sequence", () => {
  let r = advanceGesture(GESTURE_IDLE, ADMIN_SEQUENCE[0], 1000);
  r = advanceGesture(r.state, ADMIN_SEQUENCE[1], 1300);

  expect(r.state.progress).toBe(2);
  expect(r.unlocked).toBe(false);

  r = advanceGesture(r.state, [99, 99] as [number, number], 1500);
  expect(r.state.progress).toBe(0);
  expect(r.unlocked).toBe(false);
});

test("a wrong tap that matches the first spot restarts at one", () => {
  let state: GestureState = GESTURE_IDLE;
  const three: [number, number] = [7, 7];

  let r = advanceGesture(state, ADMIN_SEQUENCE[2], 1000);
  state = r.state;
  expect(state.progress).toBe(0);

  r = advanceGesture(state, ADMIN_SEQUENCE[0], 1200);
  state = r.state;
  expect(state.progress).toBe(1);
  expect(r.unlocked).toBe(false);

  r = advanceGesture(state, three, 1300);
  state = r.state;
  expect(state.progress).toBe(0);
  expect(r.unlocked).toBe(false);

  r = advanceGesture(state, ADMIN_SEQUENCE[0], 1400);
  state = r.state;
  expect(state.progress).toBe(1);
  expect(r.unlocked).toBe(false);
});

test("the sequence is defined as ten steps, not four", () => {
  const firstNine = ADMIN_SEQUENCE.slice(0, -1);
  let state: GestureState = GESTURE_IDLE;
  for (const finger of firstNine) {
    const r = advanceGesture(state, finger, 1000);
    state = r.state;
    expect(r.unlocked).toBe(false);
  }
  expect(state.progress).toBe(ADMIN_SEQUENCE.length - 1);
  expect(ADMIN_SEQUENCE.length).toBe(10);
});
