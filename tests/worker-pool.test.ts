import { expect, test } from "bun:test";

import {
  RUN_WAKE_ESCALATE_MS,
  RUN_WAKE_FLOOR_MS,
  RUN_WAKE_MAX_ATTEMPTS,
  eligibleWorkers,
  freeSlots,
  pickNextWake,
  pickWakes,
  rankWorkers,
  shouldEscalate,
  staticWorkerTargets,
  workerIdentity,
  workerIsAwake,
  type WorkerMember,
} from "../lib/runs/pool";

/**
 * Who gets woken, and when a run asks for another machine.
 *
 * These are the decisions that go wrong quietly in a fleet: a broadcast that
 * wakes four machines to run one job, a full member that keeps being chosen, or
 * an escalation that fires on every poll. All of it is pure, so the clock moves
 * and the answers are asserted.
 */

const now = Date.parse("2026-11-15T12:00:00.000Z");

const member = (overrides: Partial<WorkerMember> = {}): WorkerMember => ({
  id: "render-a",
  healthUrl: "https://render-a.example/healthz",
  pool: null,
  concurrency: 2,
  state: "active",
  activeRuns: 0,
  lastSeenAt: new Date(now - 10_000).toISOString(),
  lastWokenAt: null,
  ...overrides,
});

test("free slots never go negative", () => {
  expect(freeSlots(member({ concurrency: 2, activeRuns: 1 }))).toBe(1);
  expect(freeSlots(member({ concurrency: 1, activeRuns: 3 }))).toBe(0);
});

test("only an active, recently seen member with a slot is eligible", () => {
  const members = [
    member({ id: "ok" }),
    member({ id: "disabled", state: "disabled" }),
    member({ id: "draining", state: "draining" }),
    member({ id: "full", concurrency: 1, activeRuns: 1 }),
    member({
      id: "stale",
      lastSeenAt: new Date(now - 6 * 60_000).toISOString(),
    }),
    member({ id: "never-seen", lastSeenAt: null }),
    member({ id: "no-url", healthUrl: null }),
  ];

  expect(eligibleWorkers(members, now).map((item) => item.id)).toEqual(["ok"]);
});

test("the member with the most room is chosen first", () => {
  const ranked = rankWorkers(
    [
      member({ id: "busy", concurrency: 2, activeRuns: 1 }),
      member({ id: "idle", concurrency: 2, activeRuns: 0 }),
      member({ id: "full", concurrency: 1, activeRuns: 1 }),
    ],
    now
  );

  expect(ranked.map((item) => item.id)).toEqual(["idle", "busy"]);
});

test("an equal choice goes to the member woken longest ago, then to the id", () => {
  const ranked = rankWorkers(
    [
      member({
        id: "recent",
        lastWokenAt: new Date(now - 60_000).toISOString(),
      }),
      member({
        id: "old",
        lastWokenAt: new Date(now - 30 * 60_000).toISOString(),
      }),
      member({ id: "never-a", lastWokenAt: null }),
      member({ id: "never-b", lastWokenAt: null }),
    ],
    now
  );

  // Never woken counts as oldest; the two of those fall back to id order.
  expect(ranked.map((item) => item.id)).toEqual([
    "never-a",
    "never-b",
    "old",
    "recent",
  ]);
});

test("one wake when the best member is awake", () => {
  const wakes = pickWakes(
    [
      member({ id: "awake" }),
      member({ id: "z-awake", lastSeenAt: new Date(now - 20_000).toISOString() }),
    ],
    now
  );

  expect(wakes.map((item) => item.id)).toEqual(["awake"]);
});

test("a second wake only when the best member looks asleep", () => {
  const asleep = member({
    id: "asleep",
    lastSeenAt: new Date(now - 3 * 60_000).toISOString(),
  });
  const awake = member({ id: "awake" });

  expect(workerIsAwake(asleep, now)).toBe(false);
  expect(pickWakes([asleep, awake], now).map((item) => item.id)).toEqual([
    "asleep",
    "awake",
  ]);
});

test("nobody eligible means no wake through the fleet path", () => {
  expect(pickWakes([member({ state: "draining" })], now)).toEqual([]);
  expect(pickNextWake([member({ state: "disabled" })], now)).toBeNull();
});

test("a static fleet is used before anyone has registered", () => {
  expect(
    staticWorkerTargets("https://default.example/healthz", {
      RUN_WORKERS: "https://a.example, https://b.example/healthz",
    })
  ).toEqual([
    { id: null, url: "https://a.example/healthz" },
    { id: null, url: "https://b.example/healthz" },
  ]);

  expect(
    staticWorkerTargets("https://default.example/healthz", {
      RUN_WORKER_URL: "https://one.example/",
    })
  ).toEqual([{ id: null, url: "https://one.example/healthz" }]);

  expect(staticWorkerTargets("https://default.example/healthz", {})).toEqual([
    { id: null, url: "https://default.example/healthz" },
  ]);

  // A typo does not silently become a ping to the default host.
  expect(
    staticWorkerTargets("https://default.example/healthz", {
      RUN_WORKER_URL: "not a url",
    })
  ).toEqual([{ id: null, url: "https://default.example/healthz" }]);
});

test("a worker's identity is trimmed, and empty settings are unset", () => {
  expect(
    workerIdentity({
      RUN_WORKER_ID: "  render-a ",
      RUN_WORKER_LABEL: " ",
      RUN_WORKER_HEALTH_URL: "https://a.example/healthz",
      RUN_WORKER_POOL: "",
    })
  ).toEqual({
    id: "render-a",
    label: null,
    healthUrl: "https://a.example/healthz",
    pool: null,
  });
});

test("a run asks for another machine after waiting, once per floor, a bounded number of times", () => {
  const queued = (ms: number, lastWakeMs: number | null, attempts = 0) => ({
    status: "queued",
    queuedAt: new Date(now - ms).toISOString(),
    lastWakeAt:
      lastWakeMs === null ? null : new Date(now - lastWakeMs).toISOString(),
    wakeAttempts: attempts,
  });

  expect(shouldEscalate(queued(RUN_WAKE_ESCALATE_MS - 1, null), now)).toBe(false);
  expect(shouldEscalate(queued(RUN_WAKE_ESCALATE_MS + 1, null), now)).toBe(true);
  // Inside the floor: a poll every two seconds must not wake the fleet.
  expect(shouldEscalate(queued(5 * 60_000, RUN_WAKE_FLOOR_MS - 1), now)).toBe(false);
  expect(shouldEscalate(queued(5 * 60_000, RUN_WAKE_FLOOR_MS + 1), now)).toBe(true);
  expect(
    shouldEscalate(queued(5 * 60_000, null, RUN_WAKE_MAX_ATTEMPTS), now)
  ).toBe(false);
  expect(shouldEscalate({ ...queued(5 * 60_000, null), status: "running" }, now)).toBe(
    false
  );
});

test("the escalation tries the member woken longest ago", () => {
  const next = pickNextWake(
    [
      member({ id: "recent", lastWokenAt: new Date(now - 30_000).toISOString() }),
      member({ id: "cold", lastWokenAt: new Date(now - 60 * 60_000).toISOString() }),
    ],
    now
  );

  expect(next?.id).toBe("cold");
});
