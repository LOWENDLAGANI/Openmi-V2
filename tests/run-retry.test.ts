import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { shouldRequeueRun } from "../lib/runs/pool";
import { RUN_HEARTBEAT_STALE_MS } from "../lib/runs/limits";

/**
 * The one retry a lost worker's run gets.
 *
 * The decision is pure and tested here; the parts that need a database — that the
 * requeue is a compare-and-set on `retry_count`, that cancel wins, that the
 * reaper cannot settle a run that was handed back — are asserted where they are
 * written, because "requeued twice" is the failure that would charge a user
 * twice and is worth pinning exactly.
 */

const read = (path: string) => readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const now = Date.parse("2026-11-15T12:00:00.000Z");

const run = (overrides: Partial<Parameters<typeof shouldRequeueRun>[0]> = {}) => ({
  status: "running",
  cancelRequested: false,
  retryCount: 0,
  heartbeatAt: new Date(now - RUN_HEARTBEAT_STALE_MS - 60_000).toISOString(),
  startedAt: new Date(now - 10 * 60_000).toISOString(),
  createdAt: new Date(now - 11 * 60_000).toISOString(),
  ...overrides,
});

test("a run whose worker went quiet is handed to another machine", () => {
  expect(shouldRequeueRun(run(), now, RUN_HEARTBEAT_STALE_MS)).toBe(true);
});

test("a run that is still reporting is left alone", () => {
  expect(
    shouldRequeueRun(
      run({ heartbeatAt: new Date(now - 30_000).toISOString() }),
      now,
      RUN_HEARTBEAT_STALE_MS
    )
  ).toBe(false);
});

test("a null heartbeat falls back to when it started", () => {
  expect(
    shouldRequeueRun(
      run({ heartbeatAt: null, startedAt: new Date(now - 60_000).toISOString() }),
      now,
      RUN_HEARTBEAT_STALE_MS
    )
  ).toBe(false);

  expect(shouldRequeueRun(run({ heartbeatAt: null }), now, RUN_HEARTBEAT_STALE_MS)).toBe(
    true
  );
});

test("a run is retried once, ever", () => {
  expect(shouldRequeueRun(run({ retryCount: 1 }), now, RUN_HEARTBEAT_STALE_MS)).toBe(
    false
  );
  expect(shouldRequeueRun(run({ retryCount: 3 }), now, RUN_HEARTBEAT_STALE_MS)).toBe(
    false
  );
});

test("a cancelled run is never retried", () => {
  expect(
    shouldRequeueRun(run({ cancelRequested: true }), now, RUN_HEARTBEAT_STALE_MS)
  ).toBe(false);
});

test("only a running row is a candidate", () => {
  for (const status of ["queued", "done", "failed", "cancelled", "blocked"]) {
    expect(shouldRequeueRun(run({ status }), now, RUN_HEARTBEAT_STALE_MS)).toBe(false);
  }
});

test("the requeue is a compare-and-set on the retry counter", () => {
  const workers = read("/lib/runs/workers.ts");

  // The guard is on the row, not in memory, so two servers cannot both requeue.
  expect(workers).toContain('.eq("retry_count", 0)');
  expect(workers).toContain('.eq("status", "running")');
  expect(workers).toContain('.eq("cancel_requested", false)');

  // It is written back as 1, and the sandbox is left alone so the retry can
  // reattach to the same workspace instead of starting over.
  expect(workers).toContain("retry_count: 1,");
  expect(workers).not.toContain("sandbox_id:");

  // The reader is told, once, in the run's own event log.
  expect(workers).toContain('"run.warning"');
  expect(workers).toContain("Trying again on another machine.");
});

test("a retried run is not mistaken for one nobody claimed", () => {
  const store = read("/lib/runs/store.ts");

  // The twenty-minute rule settles rows that were never claimed; a requeued run
  // has been claimed, so it must be excluded or it would fail on arrival.
  expect(store).toContain('.is("started_at", null)');
});

test("the worker hands work back before it settles anything", () => {
  const worker = read("/lib/runs/worker.ts");
  const requeue = worker.indexOf("await requeueLostRuns(admin)");
  const reap = worker.indexOf("await reapStaleRuns(admin)");

  expect(requeue).toBeGreaterThan(-1);
  expect(reap).toBeGreaterThan(requeue);
});

test("a deployment with no worker still retries once", () => {
  // `settle_stalled_runs` runs when an account queues a run, so it is the path
  // that always executes; it has to perform the same retry, not just fail.
  const migration = read("/supabase/migrations/050_run_worker_pool.sql");
  const settle = migration.indexOf("create or replace function public.settle_stalled_runs");

  expect(settle).toBeGreaterThan(-1);

  const body = migration.slice(settle);

  expect(body).toContain("retry_count  = 1,");
  expect(body).toContain("retry_count = 0");
  expect(body).toContain("append_run_event");
  expect(body).toContain("worker-lost-retry");
});

test("the claim records the pool, and the fleet is woken through the table", () => {
  const store = read("/lib/runs/store.ts");
  const migration = read("/supabase/migrations/050_run_worker_pool.sql");
  const wake = read("/lib/runs/wake.ts");
  const runs = read("/app/api/runs/route.ts");
  const chat = read("/app/api/chat/route.ts");
  const status = read("/app/api/runs/[id]/route.ts");

  expect(store).toContain("p_pool_filter: pool");
  // The pair is written in the same update, so worker and pool cannot disagree.
  expect(migration).toContain("worker_pool  = coalesce(p_pool, r.worker_pool)");
  expect(migration).toContain("worker_id    = p_worker,");

  // The waker reads the fleet and falls back to the static URLs.
  expect(wake).toContain("await listWorkerMembers(admin)");
  expect(wake).toContain("staticWorkerTargets(fallback, env)");
  expect(wake).toContain("pickWakes(members)");

  // A queued run wakes the fleet from wherever it is queued, and a run that
  // waits asks again from its own status poll.
  expect(runs).toContain("void wakeQueue(admin).catch(() => {});");
  expect(chat).toContain("void wakeQueue(admin).catch(() => {});");
  expect(status).toContain("escalateQueuedRun(admin, snapshot.run)");
});

test("a worker says hello, keeps a heartbeat, and drains on the way out", () => {
  const worker = read("/lib/runs/worker.ts");
  const main = read("/worker/main.ts");

  expect(worker).toContain("await registerWorker(admin, {");
  expect(worker).toContain("WORKER_HEARTBEAT_MS");
  expect(worker).toContain("await drainWorker(admin, id);");

  // Identity comes from the environment, so a member keeps its row across a
  // restart; Render's own URL is the health URL when nothing else is set.
  expect(main).toContain("workerIdentity()");
  expect(main).toContain("identity.id ?? newWorkerId()");
  expect(main).toContain("RENDER_EXTERNAL_URL");
});
