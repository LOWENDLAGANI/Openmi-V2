/**
 * The shapes the operator panel and the probe routes share.
 *
 * Pure and free of `server-only` so the client component can import them
 * without pulling the sandbox SDK into the browser bundle.
 */

export type WorkerProbeState = "ok" | "failed" | "unconfigured";

export type WorkerProbeResult = {
  action: "worker";
  state: WorkerProbeState;
  detail: string;
  at: string;
  url: string | null;
  status: number | null;
  latencyMs: number | null;
  health: {
    workerId: string | null;
    concurrency: number | null;
    active: number | null;
    claimed: number | null;
    finished: number | null;
    failed: number | null;
    lastClaimAt: string | null;
    uptimeSeconds: number | null;
  } | null;
};

export type SandboxProbeResult = {
  action: "sandbox";
  state: WorkerProbeState;
  detail: string;
  at: string;
  sandboxId: string | null;
  createMs: number | null;
  execMs: number | null;
  exitCode: number | null;
  output: string;
  tornDown: "deleted" | "missing" | "failed" | null;
};

export type SandboxCleanupResult = {
  action: "cleanup";
  state: WorkerProbeState;
  detail: string;
  at: string;
  removed: number;
  kept: number;
};

export type RuntimeActionResult =
  | WorkerProbeResult
  | SandboxProbeResult
  | SandboxCleanupResult;

export type RuntimeSnapshot = {
  at: string;
  worker: {
    healthUrl: string | null;
    wakeEnabled: boolean;
    queuedRuns: number;
    runningRuns: number;
    activeWorkers: number;
    lastWorkerId: string | null;
    lastHeartbeatAt: string | null;
  };
  sandbox: {
    configured: boolean;
    template: string;
    networkMode: "off" | "restricted" | "open";
    live: number;
    stopped: number;
    due: number;
  };
  lastWorkerProbe: WorkerProbeResult | null;
  lastSandboxProbe: SandboxProbeResult | null;
};
