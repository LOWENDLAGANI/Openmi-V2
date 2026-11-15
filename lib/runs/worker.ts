import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { SupabaseClient } from "@supabase/supabase-js";

import { destroySandboxConfirmed } from "@/lib/execution/provider";
import { listRunSandboxesEveryAccount } from "@/lib/execution/sandbox-inventory";

import {
  WORKER_HEARTBEAT_MS,
  runSandboxExpired,
  workerConcurrency,
} from "./limits";
import { executeRun } from "./loop";
import { workerIdentity } from "./pool";
import { claimNextRun, reapStaleRuns } from "./store";
import { wakeQueue } from "./wake";
import {
  drainWorker,
  heartbeatWorker,
  registerWorker,
  requeueLostRuns,
} from "./workers";

/**
 * The worker process.
 *
 * Long-lived, and the only thing that executes agent work. It claims one run at
 * a time per slot from the `runs` table (`for update skip locked`), executes
 * it, and repeats. Nothing in the web app can run a loop — that is the
 * architectural line the plan draws, and this file is on the far side of it.
 *
 * On start it does the two reconciliation jobs a crash makes necessary:
 *
 *   - runs whose worker stopped reporting are marked failed, with an event, so
 *     the UI stops waiting;
 *   - run sandboxes are reconciled against their rows: a box with no row is an
 *     orphan and is destroyed, a live run's box is kept, a settled run's box is
 *     kept until `RUN_SANDBOX_TTL_HOURS` (48) have passed and then destroyed.
 *
 * Shutdown is graceful: stop claiming, let the runs in flight finish, then
 * exit. A hard kill is still safe — the sandbox pauses at its own deadline, its
 * snapshot survives, and the reaper settles the row.
 *
 * `runWorker` also keeps a small status object for the optional HTTP health
 * endpoint (`worker/main.ts`), so a hosted Web Service can answer Render's
 * health check without exposing anything about a run.
 */

const IDLE_SLEEP_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function newWorkerId(): string {
  return `${hostname().slice(0, 24)}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

/**
 * What `/healthz` may say.
 *
 * Counters and a timestamp: no run ids, no prompts, no error text beyond a
 * count. A public URL on a hosted worker should not become a window into what
 * other people asked for.
 */
export type WorkerStatus = {
  workerId: string;
  startedAt: string;
  concurrency: number;
  active: number;
  claimed: number;
  finished: number;
  failed: number;
  lastClaimAt: string | null;
};

export function createWorkerStatus(input: {
  workerId: string;
  concurrency: number;
}): WorkerStatus {
  return {
    workerId: input.workerId,
    startedAt: new Date().toISOString(),
    concurrency: input.concurrency,
    active: 0,
    claimed: 0,
    finished: 0,
    failed: 0,
    lastClaimAt: null,
  };
}

/**
 * Destroys run sandboxes that are orphaned or past their 48-hour window.
 *
 * `listRunSandboxes` is the ledger that survives a crash before a row update.
 * The rules, in order:
 *
 *   - no row with this sandbox id → destroy (a crash between create and record);
 *   - the run is queued or running → keep (it is being worked on);
 *   - the run settled less than 48 hours ago → keep (a paused workspace);
 *   - otherwise → destroy, and clear the row's `sandbox_id` so a later sweep
 *     does not try again.
 *
 * Best effort and bounded: an orphan sweep that is itself unbounded is a second
 * outage. A destroy that fails stays in the provider's ledger and is retried on
 * the next start or cron run.
 */
export async function sweepRunSandboxes(
  admin: SupabaseClient
): Promise<{ destroyed: number; kept: number }> {
  let boxes: Awaited<ReturnType<typeof listRunSandboxesEveryAccount>>;

  try {
    // Across every account: a box created under one key is invisible to a list
    // made with another, and each summary carries the key that can destroy it.
    boxes = await listRunSandboxesEveryAccount(200);
  } catch {
    return { destroyed: 0, kept: 0 };
  }

  if (boxes.length === 0) return { destroyed: 0, kept: 0 };

  type Row = {
    id: string;
    sandbox_id: string | null;
    status: string;
    ended_at: string | null;
  };

  const rows: Row[] = [];
  const ids = boxes.map((box) => box.id);

  // Chunked because `.in()` travels in the query string.
  for (let index = 0; index < ids.length; index += 50) {
    const { data } = await admin
      .from("runs")
      .select("id, sandbox_id, status, ended_at")
      .in("sandbox_id", ids.slice(index, index + 50))
      .limit(200);

    if (data) rows.push(...(data as Row[]));
  }

  const bySandbox = new Map<string, Row>();
  for (const row of rows) {
    if (row.sandbox_id) bySandbox.set(row.sandbox_id, row);
  }

  let destroyed = 0;
  let kept = 0;

  for (const box of boxes) {
    const row = bySandbox.get(box.id);

    if (!row) {
      try {
        await destroySandboxConfirmed(box.id, box.account);
        destroyed += 1;
      } catch {
        kept += 1;
      }
      continue;
    }

    if (row.status === "queued" || row.status === "running") {
      kept += 1;
      continue;
    }

    if (!runSandboxExpired(row.ended_at)) {
      kept += 1;
      continue;
    }

    try {
      await destroySandboxConfirmed(box.id, box.account);
      destroyed += 1;

      await admin
        .from("runs")
        .update({ sandbox_id: null, sandbox_account: null })
        .eq("id", row.id)
        .eq("sandbox_id", box.id);
    } catch {
      kept += 1;
    }
  }

  return { destroyed, kept };
}

export type WorkerOptions = {
  /** Injected for tests; the real entry point builds it from the service key. */
  admin: SupabaseClient;
  concurrency?: number;
  /** Resolves to ask the worker to stop claiming new runs. */
  stopSignal?: AbortSignal;
  log?: (line: string) => void;
  /** Supplied by the HTTP entry point so `/healthz` and the log agree. */
  workerId?: string;
  status?: WorkerStatus;
  /** Where this member can be woken, and what it calls itself in the panel. */
  label?: string | null;
  healthUrl?: string | null;
  /** A member with a pool takes only work addressed to it. */
  pool?: string | null;
};

export async function runWorker(options: WorkerOptions): Promise<void> {
  const { admin } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  const concurrency = options.concurrency ?? workerConcurrency();
  const id = options.workerId ?? newWorkerId();
  const status =
    options.status ?? createWorkerStatus({ workerId: id, concurrency });

  status.workerId = id;
  status.concurrency = concurrency;

  const identity = workerIdentity();
  const pool = options.pool ?? identity.pool;

  const active = new Set<Promise<void>>();
  let beats: ReturnType<typeof setInterval> | null = null;

  log(
    `[runs] worker ${id} starting, concurrency ${concurrency}${
      pool ? `, pool ${pool}` : ""
    }`
  );

  // Introduces itself so the waker can choose this member and the panel can
  // show it. Best effort: a fleet table that cannot be written still leaves a
  // worker that claims work.
  await registerWorker(admin, {
    id,
    label: options.label ?? identity.label,
    healthUrl: options.healthUrl ?? identity.healthUrl,
    pool,
    concurrency,
  });

  // While it is running, the row says how many runs it holds. That count is what
  // makes "this member has a free slot" answerable without asking the member.
  beats = setInterval(() => {
    void heartbeatWorker(admin, id, active.size);
  }, WORKER_HEARTBEAT_MS);

  try {
    // Requeue before reaping: a run whose worker died is work to hand on, not a
    // failure, and the reaper must not settle it first.
    const requeued = await requeueLostRuns(admin);
    if (requeued.length > 0) {
      log(`[runs] requeued ${requeued.length} run(s) from lost workers`);
      void wakeQueue(admin).catch(() => {});
    }

    const reaped = await reapStaleRuns(admin);
    if (reaped.length > 0) log(`[runs] reaped ${reaped.length} stale run(s)`);

    const swept = await sweepRunSandboxes(admin);
    if (swept.destroyed > 0 || swept.kept > 0) {
      log(
        `[runs] sandbox sweep: ${swept.destroyed} destroyed, ${swept.kept} kept`
      );
    }
  } catch (caught) {
    // Reconciliation is a safety net. A database that is briefly unreachable
    // must not stop the worker from claiming a run once it recovers.
    log(
      `[runs] reconciliation skipped: ${
        caught instanceof Error ? caught.message : "unknown error"
      }`
    );
  }

  while (!options.stopSignal?.aborted) {
    if (active.size < concurrency) {
      let claimed = null;

      try {
        claimed = await claimNextRun(admin, id, pool);
      } catch (caught) {
        log(
          `[runs] claim failed: ${
            caught instanceof Error ? caught.message : "unknown error"
          }`
        );
        await sleep(2_000);
        continue;
      }

      if (claimed) {
        const runId = claimed.id;
        log(`[runs] claimed ${runId}`);

        status.claimed += 1;
        status.lastClaimAt = new Date().toISOString();

        const task: Promise<void> = executeRun(claimed, { admin })
          .then((result) => {
            log(`[runs] finished ${runId}: ${result}`);
            status.finished += 1;
          })
          .catch((caught: unknown) => {
            log(
              `[runs] ${runId} threw: ${
                caught instanceof Error ? caught.message : "unknown error"
              }`
            );
            status.failed += 1;
          })
          .finally(() => {
            active.delete(task);
            status.active = active.size;
          });

        active.add(task);
        status.active = active.size;
        continue;
      }
    }

    if (active.size > 0) {
      await Promise.race([...active, sleep(IDLE_SLEEP_MS)]);
    } else {
      await sleep(IDLE_SLEEP_MS);
    }
  }

  log(`[runs] worker ${id} stopping, waiting for ${active.size} run(s)`);

  if (beats) clearInterval(beats);

  // Draining is not failure: the waker stops choosing this member, and the runs
  // it already holds finish as they would have. Only a lost heartbeat is a
  // reason to hand work to another machine.
  await drainWorker(admin, id);

  await Promise.allSettled([...active]);
  log(`[runs] worker ${id} stopped`);
}

/**
 * The safety net, callable from the cron route without a worker.
 *
 * Three jobs in this order: hand a dead worker's runs back to the queue (once),
 * settle the runs nothing is going to finish, then destroy sandboxes that are
 * orphaned or past their retention. Requeue first on purpose — the reaper must
 * not fail a run that could still be retried.
 */
export async function reconcileRuns(
  admin: SupabaseClient
): Promise<{ requeued: string[]; reaped: string[]; swept: number }> {
  const requeued = await requeueLostRuns(admin);

  if (requeued.length > 0) {
    // A requeued run is only useful if a machine hears about it.
    void wakeQueue(admin).catch(() => {});
  }

  const reaped = await reapStaleRuns(admin);
  const swept = await sweepRunSandboxes(admin);

  return { requeued, reaped, swept: swept.destroyed };
}
