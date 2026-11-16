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

import { RUN_WAKE_TIMEOUT_MS } from "./limits";

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
 * The worker's health URL, regardless of the wake switch.
 *
 * The operator panel tests the worker on demand, which is not a wake and must
 * still work when `RUN_WAKE_WORKER=off` — the switch decides whether a queued
 * run pings the host, not whether a human may. `workerHealthUrl` keeps the
 * switch for the automatic path.
 */
export function configuredWorkerHealthUrl(
  env: Record<string, string | undefined> = process.env
): string | null {
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
  return configuredWorkerHealthUrl(env);
}

/** Pings the queue's worker once. Never throws, never blocks the caller. */
export function wakeWorker(
  env: Record<string, string | undefined> = process.env
): void {
  const url = workerHealthUrl(env);
  if (!url) return;

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
