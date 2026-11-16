/**
 * Wakes a sleeping worker when a run is queued.
 *
 * The worker is a long-lived process on its own host, and a host that gives
 * instances away for free sleeps them after fifteen minutes without inbound
 * traffic. Nothing in this app talks to that host, so a run queued while it
 * sleeps waits for someone to open the health URL by hand — which is what
 * "no worker has picked this run up yet" looks like from the chat.
 *
 * This is the nudge: one request to the worker's own `/healthz`, which the host
 * counts as traffic. It is on by default, because a queue with nothing to wake
 * it is a queue that looks broken and is not. Three values decide where it goes:
 *
 *   - `RUN_WORKER_HEALTH_URL` — the exact URL, when the deployment names one;
 *   - `RUN_WORKER_URL` — the worker's base URL, with `/healthz` appended;
 *   - otherwise the blueprint's own service name (`render.yaml`, `openmi-runs`).
 *
 * `RUN_WAKE_WORKER=off` turns the ping off for a deployment that runs its worker
 * somewhere the default does not reach and does not want the request.
 *
 * Deliberately not awaited by the turn that asks for it. A cold instance boots
 * in tens of seconds and may answer 502 or nothing while it does; the request
 * that woke it is allowed to fail, because the wake already happened. A wake
 * that fails leaves the run `queued`, which is exactly what the reader is told.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { RUN_WAKE_TIMEOUT_MS } from "./limits";
import {
  pickNextWake,
  pickWakes,
  staticWorkerTargets,
  shouldEscalate,
  type WorkerTarget,
} from "./pool";
import { listWorkerMembers, markWorkerWoken } from "./workers";

/**
 * The worker's health URL when nothing is configured.
 *
 * `render.yaml` creates one service and calls it `openmi-runs`, and that is what
 * its URL is built from. Hardcoding it here is what makes the wake work without
 * an operator setting anything; a deployment that points elsewhere overrides it
 * and one that wants no ping at all takes the kill switch.
 */
export const DEFAULT_RUN_WORKER_HEALTH_URL =
  "https://openmi-runs.onrender.com/healthz";

/** The kill switch, read the way every other switch in the app is. */
export function wakeWorkerEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const flag = (env.RUN_WAKE_WORKER ?? "on").trim().toLowerCase();
  return flag !== "off" && flag !== "false" && flag !== "0" && flag !== "no";
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The health URL this deployment pings, or null when pinging is switched off.
 *
 * An explicitly configured value that is not an http URL answers null rather
 * than falling back to the default: a typo should not send traffic to a host
 * nobody meant to touch.
 */
export function workerHealthUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
  if (!wakeWorkerEnabled(env)) return null;

  const explicit = (env.RUN_WORKER_HEALTH_URL ?? "").trim();
  if (explicit.length > 0) return httpUrl(explicit);

  const base = (env.RUN_WORKER_URL ?? "").trim();
  if (base.length > 0) {
    const trimmed = base.replace(/\/+$/, "");
    return httpUrl(
      /\/healthz$/.test(trimmed) ? trimmed : `${trimmed}/healthz`
    );
  }

  return DEFAULT_RUN_WORKER_HEALTH_URL;
}

/** Pings one URL once. Never throws, never blocks the caller. */
function ping(url: string): void {
  void fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(RUN_WAKE_TIMEOUT_MS),
  })
    .then((response) => {
      // The body is counters, not content, and this caller has nothing to do
      // with it. Draining the socket is the whole job.
      void response.body?.cancel().catch(() => {});
    })
    .catch(() => {
      // A booting host may refuse the connection; the ping has landed either
      // way. The row is still queued if it did not.
    });
}

/**
 * A worker pinging itself, so a host that sleeps on silence keeps it alive.
 *
 * The waker's traffic is inbound and counts; a worker executing a run makes no
 * inbound requests at all. This is the same ping, sent from the worker while it
 * holds work, and it is a no-op when the deployment knows no health URL.
 */
export function keepWorkerAwake(url: string | null | undefined): void {
  const target = url ? httpUrl(url) : null;
  if (target) ping(target);
}

/** Pings a deployment's one static URL. Kept for the single-worker setup. */
export function wakeWorker(
  env: Record<string, string | undefined> = process.env
): void {
  const url = workerHealthUrl(env);
  if (url) ping(url);
}

/** Never wake more than this many members at once. A wake is not a broadcast. */
const MEMBER_WAKE_CAP = 3;

/**
 * Wakes the fleet for a queued run.
 *
 * The fleet table decides: a member that is awake with a free slot; a second one
 * only when the first looks asleep; and, when nobody is eligible, a bounded ping
 * at the first few members so a fleet that is entirely full still hears about
 * the work. A deployment with no registered member yet falls back to the static
 * health URLs, which is what the single-worker path always did.
 *
 * Fire-and-forget for the caller: a cold instance boots in tens of seconds, and
 * the request that woke it is allowed to fail, because the wake already landed.
 * Returns the targets pinged, for the log and for tests.
 */
export async function wakeQueue(
  admin: SupabaseClient | null,
  env: Record<string, string | undefined> = process.env
): Promise<WorkerTarget[]> {
  const fallback = workerHealthUrl(env);
  if (!fallback) return [];

  const members = (await listWorkerMembers(admin)).filter(
    (member) => member.healthUrl !== null
  );

  let targets: WorkerTarget[];

  if (members.length === 0) {
    targets = staticWorkerTargets(fallback, env);
  } else {
    const chosen = pickWakes(members);
    const selected =
      chosen.length > 0 ? chosen : members.slice(0, MEMBER_WAKE_CAP);

    targets = selected.map((member) => ({
      id: member.id,
      url: member.healthUrl as string,
    }));
  }

  for (const target of targets) {
    ping(target.url);
    if (target.id) void markWorkerWoken(admin as SupabaseClient, target.id);
  }

  return targets;
}

/**
 * One extra nudge for a run that is still waiting.
 *
 * Called from the run's own status read, which the open tab already polls, so the
 * escalation needs no cron. The throttle is written before the ping, as a
 * compare-and-set on the attempt count, so two polls a moment apart cannot both
 * escalate and a sleeping fleet is not woken every second.
 */
export async function escalateQueuedRun(
  admin: SupabaseClient | null,
  run: {
    id: string;
    status: string;
    created_at: string;
    last_wake_at: string | null;
    wake_attempts: number;
  },
  env: Record<string, string | undefined> = process.env
): Promise<boolean> {
  if (!admin) return false;
  if (!wakeWorkerEnabled(env)) return false;

  if (
    !shouldEscalate({
      status: run.status,
      queuedAt: run.created_at,
      lastWakeAt: run.last_wake_at,
      wakeAttempts: run.wake_attempts,
    })
  ) {
    return false;
  }

  const members = (await listWorkerMembers(admin)).filter(
    (member) => member.healthUrl !== null && member.state === "active"
  );

  const next = pickNextWake(members);

  const { data } = await admin
    .from("runs")
    .update({
      wake_attempts: run.wake_attempts + 1,
      last_wake_at: new Date().toISOString(),
    })
    .eq("id", run.id)
    .eq("status", "queued")
    .eq("wake_attempts", run.wake_attempts)
    .select("id");

  if (!Array.isArray(data) || data.length === 0) return false;

  if (next) {
    ping(next.healthUrl as string);
    void markWorkerWoken(admin, next.id);
    return true;
  }

  const fallback = workerHealthUrl(env);
  if (!fallback) return false;

  const [target] = staticWorkerTargets(fallback, env);
  if (target) ping(target.url);

  return true;
}
