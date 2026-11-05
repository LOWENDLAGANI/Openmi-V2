/**
 * What a run row means, in one place.
 *
 * The card in the browser imports this directly, so it is deliberately pure:
 * no database, no network, no `server-only`. The rule it exists to keep is the
 * one the gate test used to guard: a success sentence is only reachable from a
 * row that recorded a real exit code. Nothing here reads the model's opinion.
 */

import { formatDuration } from "./cost";

export type ExecutionStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "timed_out"
  | "cancelled"
  /** A mission with no tick arriving; the sandbox is still alive. */
  | "paused"
  /** A mission that stopped acting. Terminal. */
  | "stalled";

export type ExecutionStage =
  | "provision"
  | "seed"
  | "apply"
  | "install"
  | "build"
  | "typecheck"
  | "plan"
  | "work"
  | "collect";

export type FailureCode =
  | "not_configured"
  | "quota"
  | "repo_too_large"
  | "no_build_command"
  | "seed_failed"
  | "apply_failed"
  | "install_failed"
  | "build_failed"
  | "insufficient_dew"
  | "changeset_not_ready"
  | "refused"
  | "crashed"
  | "agent_failed"
  | "budget_exhausted"
  | "no_changes"
  | "stalled"
  | "sandbox_expired"
  | "missing"
  | "collect_failed";

export type ExecutionRunRow = {
  id: string;
  changeset_id: string;
  status: ExecutionStatus;
  stage: ExecutionStage;
  failure_code: FailureCode | null;
  failure_detail: string | null;
  install_command: string | null;
  build_command: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  /** Reserved before the sandbox started; settled against real minutes. */
  reserved_dew: number;
  charged_dew: number;
  started_at: string;
  ended_at: string | null;
  heartbeat_at: string | null;
};

export type ExecutionEventRow = {
  seq: number;
  at: string;
  kind: "status" | "step" | "output" | "observation";
  body: string;
};

const STAGE_LABEL: Record<ExecutionStage, string> = {
  provision: "Starting the sandbox",
  seed: "Seeding the repository",
  apply: "Applying the accepted files",
  install: "Installing dependencies",
  build: "Building",
  typecheck: "Type-checking",
  plan: "Planning the mission",
  work: "Working the goal",
  collect: "Collecting the diff",
};

const FAILURE_LABEL: Record<FailureCode, string> = {
  not_configured: "Execution is not configured on this deployment.",
  quota: "The sandbox quota is exhausted right now. Nothing ran.",
  repo_too_large: "This repository is too large to seed.",
  no_build_command: "This repository has no build command Openmi recognises.",
  seed_failed: "The repository could not be seeded into the sandbox.",
  apply_failed: "The accepted files could not be written into the sandbox.",
  install_failed: "The dependency install failed.",
  build_failed: "The build failed.",
  insufficient_dew: "There was not enough Dew to reserve a run.",
  changeset_not_ready: "Only a signed, ready changeset can be verified.",
  refused: "The sandbox refused the request.",
  crashed: "The run stopped reporting. No result was recorded.",
  agent_failed: "The agent stopped: the model call failed.",
  budget_exhausted: "The mission used its whole budget.",
  no_changes: "The agent finished without changing a file.",
  stalled: "The agent stopped acting without finishing.",
  sandbox_expired: "The sandbox expired before the mission finished.",
  missing: "The sandbox no longer exists; a new one is needed.",
  collect_failed: "The changes could not be collected from the sandbox.",
};

/** A claim, and the row it came from. `tone` drives colour, nothing else. */
export type RunDescription = {
  state:
    | "none"
    | "running"
    | "succeeded"
    | "failed"
    | "timed_out"
    | "cancelled"
    | "unavailable";
  title: string;
  detail: string;
  /** What the run cost, in the same words the ledger used. Null when free. */
  charge: string | null;
  tone: "neutral" | "accent" | "warn" | "danger";
};

export function describeRun(run: ExecutionRunRow | null): RunDescription {
  if (!run) {
    return {
      state: "none",
      title: "Not verified",
      detail:
        "Nothing has run against this diff. No build, install or check has been observed.",
      charge: null,
      tone: "neutral",
    };
  }

  // A terminal run with nothing charged must not read like a pending reserve:
  // the promise has already been settled, so "nothing charged yet" was a lie on
  // a failed start. That sentence is kept for a run that is still live.
  const charge =
    run.reserved_dew > 0 && run.charged_dew > 0
      ? `${run.charged_dew} Dew charged of ${run.reserved_dew} reserved.`
      : run.reserved_dew > 0
        ? run.status === "failed" ||
          run.status === "timed_out" ||
          run.status === "cancelled"
          ? `${run.reserved_dew} Dew reserved; no sandbox time was charged, so the unused reserve settles back.`
          : `${run.reserved_dew} Dew reserved; nothing charged yet.`
        : null;

  if (run.status === "queued" || run.status === "running") {
    return {
      state: "running",
      title: STAGE_LABEL[run.stage] ?? "Running",
      detail: run.duration_ms
        ? `Running for ${formatDuration(run.duration_ms)}.`
        : "The sandbox is being prepared.",
      charge,
      tone: "neutral",
    };
  }

  if (run.status === "paused" || run.status === "stalled") {
    return {
      state: run.status === "paused" ? "running" : "failed",
      title: run.status === "paused" ? "Paused" : "Stopped acting",
      detail:
        run.status === "paused"
          ? "This mission is waiting for its next tick. The sandbox is still alive."
          : "This mission stopped acting before it finished.",
      charge,
      tone: run.status === "paused" ? "warn" : "danger",
    };
  }

  if (run.status === "cancelled") {
    return {
      state: "cancelled",
      title: "Cancelled",
      detail: run.duration_ms
        ? `You cancelled this run after ${formatDuration(run.duration_ms)}.`
        : "You cancelled this run before it produced a result.",
      charge,
      tone: "warn",
    };
  }

  if (run.status === "timed_out") {
    return {
      state: "timed_out",
      title: "Timed out",
      detail: run.duration_ms
        ? `Stopped at the run limit after ${formatDuration(run.duration_ms)}. The sandbox was destroyed; nothing is claimed about the build.`
        : "Stopped at the run limit. The sandbox was destroyed.",
      charge,
      tone: "warn",
    };
  }

  if (run.status === "failed") {
    const code = run.failure_code ?? "refused";
    const detail = FAILURE_LABEL[code];

    return {
      state: "failed",
      title: "Verification failed",
      detail: run.failure_detail
        ? `${detail} ${run.failure_detail}`
        : detail,
      charge,
      tone: "danger",
    };
  }

  // `done` is the only status that can produce a success sentence, and even
  // then it says exactly what was observed: a command, its exit code, its time.
  if (run.exit_code === 0 && run.build_command) {
    return {
      state: "succeeded",
      title: "Build succeeded",
      detail: `\`${run.build_command}\` exited 0${
        run.duration_ms ? ` after ${formatDuration(run.duration_ms)}` : ""
      }. Tests were not run.`,
      charge,
      tone: "accent",
    };
  }

  return {
    state: "failed",
    title: "No result recorded",
    detail:
      "The run finished without a recorded build exit code, so nothing is claimed about it.",
    charge,
    tone: "warn",
  };
}

/** Stages still to come, for the progress list. */
export function isTerminal(status: ExecutionStatus): boolean {
  return (
    status === "done" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "cancelled"
  );
}
