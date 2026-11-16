import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { chatSandboxCounts } from "@/lib/execution/chat-env/store";
import {
  createSandbox,
  destroySandboxConfirmed,
  executionConfigured,
  executionNetworkMode,
  executionTemplate,
  listProbeSandboxes,
} from "@/lib/execution/provider";
import {
  configuredWorkerHealthUrl,
  wakeWorkerEnabled,
} from "@/lib/runs/wake";

import type {
  RuntimeSnapshot,
  SandboxCleanupResult,
  SandboxProbeResult,
  WorkerProbeResult,
} from "./runtime-types";

export type {
  RuntimeActionResult,
  RuntimeSnapshot,
  SandboxCleanupResult,
  SandboxProbeResult,
  WorkerProbeResult,
  WorkerProbeState,
} from "./runtime-types";

/**
 * The operator's view of the two things a run needs: a worker process polling
 * the queue, and a sandbox provider that can boot a box.
 *
 * The setup probes answer "is this configured". These answer "is it working
 * right now" — and the sandbox test deliberately creates a real box, runs one
 * command and destroys it, because a key that authenticates is not the same
 * thing as a template that boots.
 *
 * The test is short-lived by construction: five minutes at the provider, and
 * the function kills and confirms deletion before it returns. A box that could
 * not be deleted is reported as such, not hidden, and the label it was created
 * with (`kind: "probe"`) is what the cleanup action sweeps later.
 */

/** A health ping is bounded well below the route's own limit. */
export const WORKER_PROBE_TIMEOUT_MS = 15_000;

/** A cold sandbox takes tens of seconds; this is the whole test's ceiling. */
const SANDBOX_PROBE_COMMAND_TIMEOUT_MS = 30_000;

const WORKER_PROBE_KEY = "runtime_probe_worker";
const SANDBOX_PROBE_KEY = "runtime_probe_sandbox";

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message.length > 0
    ? caught.message
    : fallback;
}

/**
 * Reads a probe result from `openmi_meta`.
 *
 * The meta table is the one place this deployment already keeps service-only
 * markers, so a last-test result can survive a page reload without a migration.
 * A row that is not JSON is treated as absent rather than as an error.
 */
async function readStoredProbe<T>(
  admin: SupabaseClient,
  key: string
): Promise<T | null> {
  const { data } = await admin
    .from("openmi_meta")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (!data) return null;

  try {
    return JSON.parse(String((data as { value: unknown }).value)) as T;
  } catch {
    return null;
  }
}

type ProbeKind = "worker" | "sandbox";

/** Best effort: a probe that ran is still reported when the write fails. */
export async function rememberProbe(
  admin: SupabaseClient,
  kind: ProbeKind,
  value: WorkerProbeResult | SandboxProbeResult
): Promise<void> {
  await admin
    .from("openmi_meta")
    .upsert(
      {
        key: kind === "worker" ? WORKER_PROBE_KEY : SANDBOX_PROBE_KEY,
        value: JSON.stringify(value),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
}

/**
 * One GET to the worker's `/healthz`.
 *
 * A sleeping host may take longer than any sensible operator wait, so the
 * timeout is a real answer ("no reply in 15 seconds"), not a retry loop: the
 * next press wakes it again, and a cold instance reports itself once it is up.
 * The body is counters only, and it is quoted back without ever touching a key.
 */
export async function probeWorker(): Promise<WorkerProbeResult> {
  const at = new Date().toISOString();
  const url = configuredWorkerHealthUrl();

  if (!url) {
    return {
      action: "worker",
      state: "unconfigured",
      detail:
        "No worker health URL resolves. RUN_WORKER_HEALTH_URL, RUN_WORKER_URL or the blueprint default must name an http(s) address.",
      at,
      url: null,
      status: null,
      latencyMs: null,
      health: null,
    };
  }

  const started = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(WORKER_PROBE_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - started;
    const text = await response.text().catch(() => "");

    let parsed: Record<string, unknown> | null = null;
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return {
        action: "worker",
        state: "failed",
        detail: `The worker answered ${response.status}. A sleeping host may answer this until it wakes; press the test again.`,
        at,
        url,
        status: response.status,
        latencyMs,
        health: null,
      };
    }

    if (!parsed || parsed.ok !== true) {
      return {
        action: "worker",
        state: "failed",
        detail:
          "The URL answered, but not with the worker's health document. Check that it points at /healthz.",
        at,
        url,
        status: response.status,
        latencyMs,
        health: null,
      };
    }

    const number = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) ? value : null;
    const string = (value: unknown): string | null =>
      typeof value === "string" && value.length > 0 ? value : null;

    const health = {
      workerId: string(parsed.workerId),
      concurrency: number(parsed.concurrency),
      active: number(parsed.active),
      claimed: number(parsed.claimed),
      finished: number(parsed.finished),
      failed: number(parsed.failed),
      lastClaimAt: string(parsed.lastClaimAt),
      uptimeSeconds: number(parsed.uptimeSeconds),
    };

    return {
      action: "worker",
      state: "ok",
      detail: `The worker answered in ${latencyMs}ms${
        health.workerId ? ` as ${health.workerId}` : ""
      }${health.active !== null ? `, ${health.active} active` : ""}.`,
      at,
      url,
      status: response.status,
      latencyMs,
      health,
    };
  } catch (caught) {
    return {
      action: "worker",
      state: "failed",
      detail: `The worker did not answer within ${
        WORKER_PROBE_TIMEOUT_MS / 1000
      } seconds. ${
        caught instanceof Error && caught.name === "TimeoutError"
          ? "It is most likely asleep; press the test again."
          : messageOf(caught, "The request failed.")
      }`,
      at,
      url,
      status: null,
      latencyMs: Date.now() - started,
      health: null,
    };
  }
}

type Teardown = {
  outcome: "deleted" | "missing" | "failed";
  detail: string;
};

/** Kills the test box and asks the provider to confirm it is gone. */
async function tearDown(sandboxId: string): Promise<Teardown> {
  try {
    const outcome = await destroySandboxConfirmed(sandboxId);
    return {
      outcome,
      detail:
        outcome === "deleted"
          ? "The test box was deleted."
          : "The provider said the test box was already gone.",
    };
  } catch (caught) {
    return {
      outcome: "failed",
      detail: `The test box could not be deleted: ${messageOf(
        caught,
        "the provider refused."
      )}`,
    };
  }
}

/**
 * Boots one throwaway sandbox, runs a command, and kills it.
 *
 * Every exit path tears the box down, including a command that fails: a test
 * that leaves a billing box behind is a test that costs money every time an
 * operator is unsure. The result says whether deletion was confirmed, and the
 * cleanup action exists for the case where the request died mid-teardown.
 */
export async function probeSandbox(): Promise<SandboxProbeResult> {
  const at = new Date().toISOString();

  if (!executionConfigured()) {
    return {
      action: "sandbox",
      state: "unconfigured",
      detail:
        "E2B_API_KEY is not set, or EXECUTION_ENABLED is off. The test would have nowhere to boot.",
      at,
      sandboxId: null,
      createMs: null,
      execMs: null,
      exitCode: null,
      output: "",
      tornDown: null,
    };
  }

  const started = Date.now();
  let sandboxId: string | null = null;
  let createMs: number | null = null;

  try {
    const handle = await createSandbox(`probe-${randomUUID().slice(0, 8)}`, {
      ttlMinutes: 5,
      labels: { kind: "probe" },
    });

    sandboxId = handle.id;
    createMs = Date.now() - started;

    // A fresh box has no checkout, so the working directory is the user's home
    // rather than the workspace root a run would use.
    const command = await handle.exec(
      "echo openmi-probe-ok && uname -s",
      "/home/user",
      SANDBOX_PROBE_COMMAND_TIMEOUT_MS
    );

    const teardown = await tearDown(sandboxId);
    const commandOk = command.exitCode === 0;
    const ok = commandOk && teardown.outcome !== "failed";

    return {
      action: "sandbox",
      state: ok ? "ok" : "failed",
      detail: ok
        ? `The sandbox booted in ${createMs}ms, ran the command in ${command.durationMs}ms and ${teardown.detail.toLowerCase()}`
        : `The sandbox ${
            commandOk ? "ran the command" : `returned exit ${command.exitCode}`
          }. ${teardown.detail}`,
      at,
      sandboxId,
      createMs,
      execMs: command.durationMs,
      exitCode: command.exitCode,
      output: command.output.slice(0, 300),
      tornDown: teardown.outcome,
    };
  } catch (caught) {
    const quarantine = sandboxId ? await tearDown(sandboxId) : null;

    return {
      action: "sandbox",
      state: "failed",
      detail: `${messageOf(caught, "The sandbox test failed.")}${
        quarantine ? ` ${quarantine.detail}` : ""
      }`,
      at,
      sandboxId,
      createMs,
      execMs: null,
      exitCode: null,
      output: "",
      tornDown: quarantine?.outcome ?? null,
    };
  }
}

/**
 * Destroys test boxes a previous run left behind.
 *
 * The provider is the ledger here: a probe box carries no database row, so the
 * label written at create time is the only way to find one after a crash.
 */
export async function cleanupProbeSandboxes(): Promise<SandboxCleanupResult> {
  const at = new Date().toISOString();

  if (!executionConfigured()) {
    return {
      action: "cleanup",
      state: "unconfigured",
      detail: "Execution is not configured, so there are no test boxes to find.",
      at,
      removed: 0,
      kept: 0,
    };
  }

  let boxes: Awaited<ReturnType<typeof listProbeSandboxes>>;

  try {
    boxes = await listProbeSandboxes(100);
  } catch (caught) {
    return {
      action: "cleanup",
      state: "failed",
      detail: messageOf(caught, "The provider's test boxes could not be listed."),
      at,
      removed: 0,
      kept: 0,
    };
  }

  let removed = 0;
  let kept = 0;

  for (const box of boxes) {
    try {
      await destroySandboxConfirmed(box.id);
      removed += 1;
    } catch {
      kept += 1;
    }
  }

  return {
    action: "cleanup",
    state: kept === 0 ? "ok" : "failed",
    detail:
      boxes.length === 0
        ? "No test boxes were left behind."
        : `${removed} test box${removed === 1 ? "" : "es"} killed and deleted${
            kept > 0 ? `; ${kept} could not be deleted and will be retried` : ""
          }.`,
    at,
    removed,
    kept,
  };
}

/**
 * The numbers the panel polls: queue depth, live workers, chat workspaces and
 * the last two test results.
 *
 * No provider call is made on a poll — a monitor that lists a remote estate
 * every twenty seconds is a monitor that hits a rate limit. The provider is
 * contacted only when an operator presses a test or a cleanup.
 */
export async function readRuntimeSnapshot(
  admin: SupabaseClient
): Promise<RuntimeSnapshot> {
  const [queued, running, workers, latest, counts, workerProbe, sandboxProbe] =
    await Promise.all([
      admin.from("runs").select("id", { count: "exact", head: true }).eq("status", "queued"),
      admin.from("runs").select("id", { count: "exact", head: true }).eq("status", "running"),
      admin
        .from("runs")
        .select("worker_id")
        .eq("status", "running")
        .not("worker_id", "is", null)
        .limit(200),
      admin
        .from("runs")
        .select("worker_id, heartbeat_at")
        .not("heartbeat_at", "is", null)
        .order("heartbeat_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      chatSandboxCounts(admin),
      readStoredProbe<WorkerProbeResult>(admin, WORKER_PROBE_KEY),
      readStoredProbe<SandboxProbeResult>(admin, SANDBOX_PROBE_KEY),
    ]);

  const workerIds = new Set(
    ((workers.data ?? []) as Array<{ worker_id: string | null }>)
      .map((row) => row.worker_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  const newest = (latest.data ?? null) as {
    worker_id: string | null;
    heartbeat_at: string | null;
  } | null;

  return {
    at: new Date().toISOString(),
    worker: {
      healthUrl: configuredWorkerHealthUrl(),
      wakeEnabled: wakeWorkerEnabled(),
      queuedRuns: queued.count ?? 0,
      runningRuns: running.count ?? 0,
      activeWorkers: workerIds.size,
      lastWorkerId: newest?.worker_id ?? null,
      lastHeartbeatAt: newest?.heartbeat_at ?? null,
    },
    sandbox: {
      configured: executionConfigured(),
      template: executionTemplate(),
      networkMode: executionNetworkMode(),
      live: counts.live,
      stopped: counts.stopped,
      due: counts.due,
    },
    lastWorkerProbe: workerProbe,
    lastSandboxProbe: sandboxProbe,
  };
}
