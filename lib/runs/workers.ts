import type { SupabaseClient } from "@supabase/supabase-js";

import { RUN_HEARTBEAT_STALE_MS } from "./limits";
import {
  WORKER_STALE_MS,
  shouldRequeueRun,
  workerIsKnown,
  type WorkerMember,
  type WorkerState,
} from "./pool";
import { appendEvent } from "./store";

/**
 * The worker fleet's bookkeeping, and the one retry a lost run gets.
 *
 * Every function takes the service-role client: `run_workers` is service-only,
 * like `chat_sandboxes`, because a browser never names or wakes a worker. All of
 * them are best effort — a fleet table that cannot be written is a worse wake-up
 * call, not a failed run.
 *
 * `requeueLostRuns` is the interesting one. It is a compare-and-set on
 * `retry_count = 0`, so when two servers notice the same dead worker at the same
 * moment, exactly one of them requeues and the other writes nothing. That is the
 * whole reason the counter is a column instead of a decision.
 */

type Client = SupabaseClient;

/** A worker says hello on start. A stale row for the same id is overwritten. */
export async function registerWorker(
  admin: Client,
  input: {
    id: string;
    label?: string | null;
    healthUrl?: string | null;
    pool?: string | null;
    concurrency: number;
  }
): Promise<void> {
  const now = new Date().toISOString();

  try {
    await admin.from("run_workers").upsert(
      {
        id: input.id,
        label: input.label ?? null,
        health_url: input.healthUrl ?? null,
        pool: input.pool ?? null,
        concurrency: Math.max(1, Math.trunc(input.concurrency)),
        state: "active",
        active_runs: 0,
        last_seen_at: now,
      },
      { onConflict: "id" }
    );
  } catch {
    // A worker that cannot register still claims work; the waker falls back to
    // the static health URLs, which is the behaviour before this table existed.
  }
}

/** How many runs this worker is holding, and that it is still here. */
export async function heartbeatWorker(
  admin: Client,
  id: string,
  activeRuns: number
): Promise<void> {
  try {
    await admin
      .from("run_workers")
      .update({
        last_seen_at: new Date().toISOString(),
        active_runs: Math.max(0, Math.trunc(activeRuns)),
      })
      .eq("id", id);
  } catch {
    // A database blip must not stop the queue: the next beat fixes the count.
  }
}

/**
 * Marks a worker as shutting down.
 *
 * Draining is not failure: the waker stops choosing it, and the runs it already
 * holds finish as they would have. Only a lost heartbeat triggers a retry.
 */
export async function drainWorker(admin: Client, id: string): Promise<void> {
  try {
    await admin
      .from("run_workers")
      .update({
        state: "draining",
        active_runs: 0,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", id);
  } catch {
    // A member left `active` in the table stops being chosen once its row goes
    // stale, which takes five minutes. Annoying, not dangerous.
  }
}

/** Records that the waker pinged this member, for the tie-break. */
export async function markWorkerWoken(admin: Client, id: string): Promise<void> {
  try {
    await admin
      .from("run_workers")
      .update({ last_woken_at: new Date().toISOString() })
      .eq("id", id);
  } catch {
    // The only cost is a less even spread of wake-ups.
  }
}

type WorkerRow = {
  id: string;
  label: string | null;
  health_url: string | null;
  pool: string | null;
  concurrency: number | string;
  state: string;
  active_runs: number | string;
  last_seen_at: string | null;
  last_woken_at: string | null;
};

function asState(value: unknown): WorkerState {
  return value === "draining" || value === "disabled" ? value : "active";
}

/** The fleet, as the waker and the admin panel read it. */
export async function listWorkerMembers(
  admin: Client | null,
  limit = 50
): Promise<WorkerMember[]> {
  if (!admin) return [];

  try {
    const { data } = await admin
      .from("run_workers")
      .select(
        "id, label, health_url, pool, concurrency, state, active_runs, last_seen_at, last_woken_at"
      )
      .order("last_seen_at", { ascending: false })
      .limit(limit);

    return ((data ?? []) as WorkerRow[]).map((row) => ({
      id: String(row.id),
      healthUrl: row.health_url ? String(row.health_url) : null,
      pool: row.pool ? String(row.pool) : null,
      concurrency: Math.max(1, Number(row.concurrency ?? 1)),
      state: asState(row.state),
      activeRuns: Math.max(0, Number(row.active_runs ?? 0)),
      lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
      lastWokenAt: row.last_woken_at ? String(row.last_woken_at) : null,
    }));
  } catch {
    return [];
  }
}

export type WorkerFleetRow = WorkerMember & {
  label: string | null;
  /** False when the member has not reported for longer than the stale window. */
  alive: boolean;
  slots: number;
};

export type WorkerFleetReport = {
  workers: WorkerFleetRow[];
  aliveCount: number;
  staleMs: number;
  checkedAt: string;
};

/** The admin panel's view: who is here, how busy, and when they last spoke. */
export async function workerFleet(
  admin: Client | null,
  now: number = Date.now()
): Promise<WorkerFleetReport> {
  if (!admin) {
    return { workers: [], aliveCount: 0, staleMs: WORKER_STALE_MS, checkedAt: new Date(now).toISOString() };
  }

  let rows: WorkerRow[] = [];

  try {
    const { data } = await admin
      .from("run_workers")
      .select(
        "id, label, health_url, pool, concurrency, state, active_runs, last_seen_at, last_woken_at"
      )
      .order("last_seen_at", { ascending: false })
      .limit(50);

    rows = (data ?? []) as WorkerRow[];
  } catch {
    rows = [];
  }

  const workers: WorkerFleetRow[] = rows.map((row) => {
    const member: WorkerMember = {
      id: String(row.id),
      healthUrl: row.health_url ? String(row.health_url) : null,
      pool: row.pool ? String(row.pool) : null,
      concurrency: Math.max(1, Number(row.concurrency ?? 1)),
      state: asState(row.state),
      activeRuns: Math.max(0, Number(row.active_runs ?? 0)),
      lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
      lastWokenAt: row.last_woken_at ? String(row.last_woken_at) : null,
    };

    return {
      ...member,
      label: row.label ? String(row.label) : null,
      alive: member.state === "active" && workerIsKnown(member, now),
      slots: Math.max(0, member.concurrency - member.activeRuns),
    };
  });

  return {
    workers,
    aliveCount: workers.filter((worker) => worker.alive).length,
    staleMs: WORKER_STALE_MS,
    checkedAt: new Date(now).toISOString(),
  };
}

/**
 * Hands a dead worker's runs back to the queue — once each, ever.
 *
 * A run whose worker stopped reporting is not finished and not necessarily
 * failed: the machine may have been replaced, suspended or restarted. If it has
 * never been retried, it goes back to the queue with `retry_count = 1`; if it has,
 * it is left to the ordinary settle path, which fails it with the message it
 * always had.
 *
 * `created_at` is reset on the retry on purpose. The queue's age rules — the
 * twenty-minute "nobody picked this up" failure, the forty-five-second wake
 * escalation — are about waiting in the queue, and a retry has waited zero
 * seconds. The run id, its messages and its event log are what keep the history;
 * the transcript is the handover, as the plan says.
 *
 * Cancel wins: a run the reader stopped is never requeued.
 */
export async function requeueLostRuns(
  admin: Client,
  now: number = Date.now(),
  staleMs: number = RUN_HEARTBEAT_STALE_MS
): Promise<string[]> {
  const cutoff = new Date(now - staleMs).toISOString();

  const { data } = await admin
    .from("runs")
    .select(
      "id, status, cancel_requested, retry_count, heartbeat_at, started_at, created_at"
    )
    .eq("status", "running")
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`)
    .lt("created_at", cutoff)
    .limit(20);

  const candidates = (data ?? []) as Array<{
    id: string;
    status: string;
    cancel_requested: boolean | null;
    retry_count: number | null;
    heartbeat_at: string | null;
    started_at: string | null;
    created_at: string;
  }>;

  const requeued: string[] = [];

  for (const run of candidates) {
    const eligible = shouldRequeueRun(
      {
        status: String(run.status),
        cancelRequested: Boolean(run.cancel_requested),
        retryCount: Number(run.retry_count ?? 0),
        heartbeatAt: run.heartbeat_at,
        startedAt: run.started_at,
        createdAt: run.created_at,
      },
      now,
      staleMs
    );

    if (!eligible) continue;

    // The compare-and-set: only one server can move a row from retry 0 to 1.
    const { data: won } = await admin
      .from("runs")
      .update({
        status: "queued",
        worker_id: null,
        worker_pool: null,
        retry_count: 1,
        started_at: null,
        heartbeat_at: null,
        ended_at: null,
        created_at: new Date(now).toISOString(),
      })
      .eq("id", run.id)
      .eq("status", "running")
      .eq("retry_count", 0)
      .eq("cancel_requested", false)
      .select("id");

    if (!Array.isArray(won) || won.length === 0) continue;

    requeued.push(String(run.id));

    await appendEvent(admin, run.id, "run.warning", {
      code: "worker-lost-retry",
      message:
        "The machine running this stopped responding. Trying again on another machine.",
    });
  }

  return requeued;
}

/** Used by the requeue scan and the run's own status read. */
export { RUN_HEARTBEAT_STALE_MS };
