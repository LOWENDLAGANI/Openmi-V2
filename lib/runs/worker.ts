import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  destroySandboxConfirmed,
  listRunSandboxes,
} from "@/lib/execution/provider";

import { RUN_WALL_CLOCK_MS, workerConcurrency } from "./limits";
import { executeRun } from "./loop";
import { claimNextRun, reapStaleRuns } from "./store";

/**
 * The worker process.
 *
 * Long-lived, no public route, and the only thing that executes agent work. It
 * claims one run at a time per slot from the `runs` table (`for update skip
 * locked`), executes it, and repeats. Nothing in the web app can run a loop —
 * that is the architectural line the plan draws, and this file is on the far
 * side of it.
 *
 * On start it does the two reconciliation jobs a crash makes necessary:
 *
 *   - runs whose worker stopped reporting are marked failed, with an event, so
 *     the UI stops waiting;
 *   - sandboxes labelled `kind=run` that no live row points at are destroyed,
 *     because a row is the only reason a box should exist.
 *
 * Shutdown is graceful: stop claiming, let the runs in flight finish, then
 * exit. A hard kill is still safe — the provider's timeout kills the box and
 * the reaper settles the row.
 */

const IDLE_SLEEP_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function workerId(): string {
  return `${hostname().slice(0, 24)}-${process.pid}-${randomUUID().slice(0, 8)}`;
}

/**
 * Destroys run sandboxes no live row claims.
 *
 * Best effort and bounded: an orphan sweep that is itself unbounded is a second
 * outage. A destroy that fails stays in the provider's own ledger and is retried
 * on the next start or cron run.
 */
export async function sweepOrphanRunSandboxes(
  admin: SupabaseClient
): Promise<number> {
  let boxes: Awaited<ReturnType<typeof listRunSandboxes>>;

  try {
    boxes = await listRunSandboxes(200);
  } catch {
    return 0;
  }

  if (boxes.length === 0) return 0;

  const { data } = await admin
    .from("runs")
    .select("sandbox_id")
    .in("status", ["queued", "running"])
    .not("sandbox_id", "is", null)
    .limit(500);

  const live = new Set(
    ((data ?? []) as Array<{ sandbox_id: string | null }>)
      .map((row) => row.sandbox_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  let destroyed = 0;

  for (const box of boxes) {
    if (live.has(box.id)) continue;

    try {
      await destroySandboxConfirmed(box.id);
      destroyed += 1;
    } catch {
      // Retried on the next sweep.
    }
  }

  return destroyed;
}

export type WorkerOptions = {
  /** Injected for tests; the real entry point builds it from the service key. */
  admin: SupabaseClient;
  concurrency?: number;
  /** Resolves to ask the worker to stop claiming new runs. */
  stopSignal?: AbortSignal;
  log?: (line: string) => void;
};

export async function runWorker(options: WorkerOptions): Promise<void> {
  const { admin } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  const concurrency = options.concurrency ?? workerConcurrency();
  const id = workerId();
  const active = new Set<Promise<void>>();

  log(`[runs] worker ${id} starting, concurrency ${concurrency}`);

  try {
    const reaped = await reapStaleRuns(admin);
    if (reaped.length > 0) log(`[runs] reaped ${reaped.length} stale run(s)`);

    const swept = await sweepOrphanRunSandboxes(admin);
    if (swept > 0) log(`[runs] destroyed ${swept} orphan sandbox(es)`);
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
        claimed = await claimNextRun(admin, id);
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

        const task: Promise<void> = executeRun(claimed, { admin })
          .then((status) => {
            log(`[runs] finished ${runId}: ${status}`);
          })
          .catch((caught: unknown) => {
            log(
              `[runs] ${runId} threw: ${
                caught instanceof Error ? caught.message : "unknown error"
              }`
            );
          })
          .finally(() => {
            active.delete(task);
          });

        active.add(task);
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
  await Promise.allSettled([...active]);
  log(`[runs] worker ${id} stopped`);
}

/** The stale-run sweep, callable from the cron route without a worker. */
export async function reconcileRuns(
  admin: SupabaseClient
): Promise<{ reaped: string[]; swept: number }> {
  const reaped = await reapStaleRuns(admin);
  const swept = await sweepOrphanRunSandboxes(admin);

  return { reaped, swept };
}

export { RUN_WALL_CLOCK_MS };
