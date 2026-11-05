/**
 * What a mission row means, in one place.
 *
 * The card imports this directly, so it is pure — no database, no network, no
 * `server-only`. Every sentence is a rendering of a stored row: a command
 * count comes from `execution_commands`, a result comes from the collected
 * diff, and there is no sentence for "tests passed" because this phase has no
 * test contract to back one.
 */

import { formatClock } from "./budget";
import type {
  ExecutionStage,
  ExecutionStatus,
  FailureCode,
} from "../status";

export type MissionCommandRow = {
  seq: number;
  at: string;
  purpose: string;
  command: string;
  cwd: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  output_tail: string;
  truncated: boolean;
  timed_out: boolean;
};

export type MissionRow = {
  id: string;
  owner: string;
  chat_id: string;
  model: string | null;
  status: ExecutionStatus;
  stage: ExecutionStage;
  goal: string | null;
  autonomy: "plan" | "act" | "ship";
  repo_full_name: string;
  base_sha: string;
  failure_code: FailureCode | null;
  failure_detail: string | null;
  sandbox_id: string | null;
  commands_count: number;
  changed_files: number | null;
  diff_bytes: number | null;
  reserved_dew: number;
  charged_dew: number;
  started_at: string;
  deadline_at: string | null;
  last_tick_at: string | null;
  ended_at: string | null;
  heartbeat_at: string | null;
  result_changeset_id: string | null;
};

export type MissionDescription = {
  state:
    | "none"
    | "running"
    | "paused"
    | "succeeded"
    | "failed"
    | "timed_out"
    | "cancelled";
  title: string;
  detail: string;
  charge: string | null;
  tone: "neutral" | "accent" | "warn" | "danger";
};

const FAILURE_LABEL: Record<string, string> = {
  not_configured: "Execution is not configured on this deployment.",
  quota: "The sandbox quota is exhausted right now. Nothing ran.",
  repo_too_large: "This repository is too large to seed.",
  seed_failed: "The repository could not be seeded into the sandbox.",
  apply_failed: "A file could not be written into the sandbox.",
  agent_failed: "The agent stopped: the model call failed.",
  budget_exhausted: "The mission used its whole budget.",
  no_changes: "The agent finished without changing a file.",
  stalled: "The agent stopped acting without finishing.",
  sandbox_expired: "The sandbox expired before the mission finished.",
  collect_failed: "The changes could not be collected from the sandbox.",
  crashed: "The mission stopped reporting. No result was recorded.",
  refused: "The sandbox refused the request.",
};

function isMissionTerminal(status: ExecutionStatus): boolean {
  return (
    status === "done" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "cancelled" ||
    status === "stalled"
  );
}

export { isMissionTerminal };

export function describeMission(
  run: MissionRow | null,
  commandCount: number = 0
): MissionDescription {
  if (!run) {
    return {
      state: "none",
      title: "No mission",
      detail: "No goal has been given a sandbox in this chat yet.",
      charge: null,
      tone: "neutral",
    };
  }

  const commands = Math.max(commandCount, run.commands_count ?? 0);

  const charge =
    run.charged_dew > 0
      ? `${run.charged_dew} Dew charged of ${run.reserved_dew} reserved.`
      : run.reserved_dew > 0
        ? `${run.reserved_dew} Dew reserved; nothing charged yet.`
        : null;

  if (run.status === "queued" || run.status === "running") {
    return {
      state: "running",
      title: "Working",
      detail: `${commands} command(s) so far. The terminal below is the record, not a summary of it.`,
      charge,
      tone: "neutral",
    };
  }

  if (run.status === "paused") {
    return {
      state: "paused",
      title: "Paused",
      detail: `The mission is waiting for the tab to continue. ${commands} command(s) recorded; the sandbox still holds its workspace.`,
      charge,
      tone: "warn",
    };
  }

  if (run.status === "cancelled") {
    return {
      state: "cancelled",
      title: "Stopped",
      detail: `You stopped this mission after ${commands} command(s). The workspace was destroyed.`,
      charge,
      tone: "warn",
    };
  }

  if (run.status === "timed_out") {
    return {
      state: "timed_out",
      title: "Out of time",
      detail: `Stopped at the mission limit after ${commands} command(s). Anything the agent changed before that point is kept.`,
      charge,
      tone: "warn",
    };
  }

  if (run.status === "stalled") {
    return {
      state: "failed",
      title: "Stopped acting",
      detail: `Two ticks passed with no command and no finish, so the mission was stopped after ${commands} command(s).`,
      charge,
      tone: "warn",
    };
  }

  if (run.status === "failed") {
    const label = FAILURE_LABEL[run.failure_code ?? "refused"] ?? "The mission failed.";

    return {
      state: "failed",
      title: "Mission failed",
      detail: run.failure_detail ? `${label} ${run.failure_detail}` : label,
      charge,
      tone: "danger",
    };
  }

  // `done` is the only status that can produce a finished sentence, and it
  // states only what the collected diff and the ledger recorded.
  if (run.result_changeset_id && (run.changed_files ?? 0) > 0) {
    return {
      state: "succeeded",
      title: "Finished",
      detail: `${run.changed_files} file(s) changed after ${commands} command(s). The diff is below; nothing has been written to GitHub.`,
      charge,
      tone: "accent",
    };
  }

  if (run.changed_files === 0) {
    return {
      state: "succeeded",
      title: "Nothing to change",
      detail: `The agent finished after ${commands} command(s) without modifying the workspace.`,
      charge,
      tone: "neutral",
    };
  }

  return {
    state: "failed",
    title: "No result recorded",
    detail:
      "The mission ended without a collected diff, so nothing is claimed about its result.",
    charge,
    tone: "warn",
  };
}

/** "run `npm run build` · exit 0 · 12s" — the card's one-line command shape. */
export function commandLine(command: MissionCommandRow): string {
  if (command.exit_code === null) {
    return `running · ${command.command}`;
  }

  const duration = command.duration_ms ? formatClock(command.duration_ms) : "";

  return [
    `exit ${command.exit_code}${command.timed_out ? " (timed out)" : ""}`,
    duration,
    command.command,
  ]
    .filter((part) => part.length > 0)
    .join(" · ");
}
