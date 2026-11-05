import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { EXEC_MAX_FILES, EXEC_MAX_PATCH_BYTES } from "../commands";
import type { ExecResult, SandboxHandle } from "../provider";
import {
  MISSION_MAX_OUTPUT_BYTES,
  MISSION_MAX_COMMANDS,
  MISSION_WORKDIR,
  missionDeadline,
  missionReserveDew,
  type MissionAutonomy,
} from "./budget";
import type { MissionCommandRow, MissionRow } from "./status";

/**
 * Reads and writes for missions.
 *
 * Missions are rows in `execution_runs`, so billing, ownership and staleness
 * are the existing ones. What is new is `execution_commands`, the ledger: a
 * command row is written before the command runs and completed after, which is
 * what lets the card say "running" instead of guessing.
 *
 * The browser reads through its own session (owner RLS); every write here uses
 * the service role, because a mission is something a server observed.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

const MISSION_COLUMNS =
  "id, owner, chat_id, status, stage, goal, autonomy, model, repo_full_name, base_sha, failure_code, failure_detail, sandbox_id, commands_count, changed_files, diff_bytes, reserved_dew, charged_dew, started_at, deadline_at, last_tick_at, ended_at, heartbeat_at, result_changeset_id";

function toMission(row: Record<string, unknown>): MissionRow {
  return {
    id: String(row.id),
    owner: String(row.owner),
    chat_id: String(row.chat_id),
    model: row.model ? String(row.model) : null,
    status: row.status as MissionRow["status"],
    stage: row.stage as MissionRow["stage"],
    goal: row.goal ? String(row.goal) : null,
    autonomy: (row.autonomy as MissionAutonomy) ?? "act",
    repo_full_name: String(row.repo_full_name),
    base_sha: String(row.base_sha),
    failure_code: (row.failure_code as MissionRow["failure_code"]) ?? null,
    failure_detail: row.failure_detail ? String(row.failure_detail) : null,
    sandbox_id: row.sandbox_id ? String(row.sandbox_id) : null,
    commands_count: Number(row.commands_count ?? 0),
    changed_files: row.changed_files === null ? null : Number(row.changed_files),
    diff_bytes: row.diff_bytes === null ? null : Number(row.diff_bytes),
    reserved_dew: Number(row.reserved_dew ?? 0),
    charged_dew: Number(row.charged_dew ?? 0),
    started_at: String(row.started_at),
    deadline_at: row.deadline_at ? String(row.deadline_at) : null,
    last_tick_at: row.last_tick_at ? String(row.last_tick_at) : null,
    ended_at: row.ended_at ? String(row.ended_at) : null,
    heartbeat_at: row.heartbeat_at ? String(row.heartbeat_at) : null,
    result_changeset_id: row.result_changeset_id
      ? String(row.result_changeset_id)
      : null,
  };
}

export async function createMissionRun(
  admin: Admin,
  input: {
    id: string;
    owner: string;
    chatId: string;
    goal: string;
    autonomy: MissionAutonomy;
    model: string;
    repo: string;
    baseSha: string;
    minutes: number;
    startedAt: number;
  }
): Promise<void> {
  const { error } = await admin.from("execution_runs").insert({
    id: input.id,
    owner: input.owner,
    chat_id: input.chatId,
    kind: "mission",
    changeset_id: null,
    goal: input.goal.slice(0, 4_000),
    autonomy: input.autonomy,
    model: input.model,
    repo_full_name: input.repo,
    base_sha: input.baseSha,
    status: "queued",
    stage: "provision",
    reserved_dew: missionReserveDew(input.minutes),
    deadline_at: missionDeadline(input.startedAt, input.minutes),
    heartbeat_at: new Date().toISOString(),
  });

  if (error) throw new Error(error.message);
}

export async function readMission(
  admin: Admin,
  runId: string
): Promise<MissionRow | null> {
  const { data } = await admin
    .from("execution_runs")
    .select(MISSION_COLUMNS)
    .eq("id", runId)
    .eq("kind", "mission")
    .maybeSingle();

  return data ? toMission(data as Record<string, unknown>) : null;
}

export async function readLatestMission(
  admin: Admin,
  owner: string,
  chatId: string
): Promise<MissionRow | null> {
  const { data } = await admin
    .from("execution_runs")
    .select(MISSION_COLUMNS)
    .eq("owner", owner)
    .eq("chat_id", chatId)
    .eq("kind", "mission")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? toMission(data as Record<string, unknown>) : null;
}

export async function updateMission(
  admin: Admin,
  runId: string,
  patch: {
    status?: MissionRow["status"];
    stage?: MissionRow["stage"];
    sandbox_id?: string | null;
    failure_code?: MissionRow["failure_code"];
    failure_detail?: string | null;
    changed_files?: number | null;
    diff_bytes?: number | null;
    result_changeset_id?: string | null;
    last_tick_at?: string | null;
    ended_at?: string | null;
    charged_dew?: number;
    commands_count?: number;
  },
  options: { onlyWhileLive?: boolean } = {}
): Promise<void> {
  let query = admin
    .from("execution_runs")
    .update({ ...patch, heartbeat_at: new Date().toISOString() })
    .eq("id", runId);

  if (options.onlyWhileLive) {
    query = query.in("status", ["queued", "running", "paused"]);
  }

  await query;
}

/**
 * Claims the right to advance a mission.
 *
 * Two polls can land at once; only one may run commands. The claim is an
 * update, so it is atomic: the row's `last_tick_at` moves only if it was null
 * or older than a second and a half, and a caller that matched nothing returns
 * without doing any work.
 */
export async function claimTick(
  admin: Admin,
  runId: string,
  now: number
): Promise<MissionRow | null> {
  const iso = new Date(now).toISOString();
  const staleBefore = new Date(now - 1_500).toISOString();

  const { data } = await admin
    .from("execution_runs")
    .update({ status: "running", last_tick_at: iso, stage: "work" })
    .eq("id", runId)
    .eq("kind", "mission")
    .in("status", ["queued", "running", "paused"])
    .or(`last_tick_at.is.null,last_tick_at.lt.${staleBefore}`)
    .select(MISSION_COLUMNS);

  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  return row ? toMission(row) : null;
}

export async function recordCommand(
  admin: Admin,
  input: {
    runId: string;
    owner: string;
    seq: number;
    purpose: string;
    command: string;
    cwd: string | null;
  }
): Promise<void> {
  if (input.seq > MISSION_MAX_COMMANDS) {
    throw new Error(`a mission runs at most ${MISSION_MAX_COMMANDS} commands`);
  }

  const { error } = await admin.from("execution_commands").insert({
    run_id: input.runId,
    owner: input.owner,
    seq: input.seq,
    purpose: input.purpose.slice(0, 200),
    command: input.command,
    cwd: input.cwd,
  });

  if (error) throw new Error(error.message);
}

export async function completeCommand(
  admin: Admin,
  runId: string,
  seq: number,
  result: ExecResult
): Promise<void> {
  const tail = result.output.slice(0, MISSION_MAX_OUTPUT_BYTES);

  await admin
    .from("execution_commands")
    .update({
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      output_tail: tail,
      truncated: result.truncated,
      timed_out: result.timedOut,
    })
    .eq("run_id", runId)
    .eq("seq", seq);

  // `commands_count` on the run row is refreshed from the ledger by the caller.
  // Deriving it from rows rather than incrementing is what keeps a retry from
  // double-counting.
}

export async function countCommands(admin: Admin, runId: string): Promise<number> {
  const { count } = await admin
    .from("execution_commands")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId);

  return count ?? 0;
}

export async function readCommands(
  admin: Admin,
  runId: string,
  limit: number = MISSION_MAX_COMMANDS
): Promise<MissionCommandRow[]> {
  const { data } = await admin
    .from("execution_commands")
    .select(
      "seq, at, purpose, command, cwd, exit_code, duration_ms, output_tail, truncated, timed_out"
    )
    .eq("run_id", runId)
    .order("seq", { ascending: true })
    .limit(limit);

  return (data ?? []) as MissionCommandRow[];
}

export async function appendMissionMessage(
  admin: Admin,
  runId: string,
  seq: number,
  message: unknown
): Promise<void> {
  await admin.from("mission_messages").insert({ run_id: runId, seq, message });
}

export async function readMissionMessages(
  admin: Admin,
  runId: string,
  limit: number = 40
): Promise<Array<{ seq: number; message: Record<string, unknown> }>> {
  const { data } = await admin
    .from("mission_messages")
    .select("seq, message")
    .eq("run_id", runId)
    .order("seq", { ascending: false })
    .limit(limit);

  return ((data ?? []) as Array<{ seq: number; message: Record<string, unknown> }>).reverse();
}

export async function destroySandbox(sandboxId: string | null): Promise<void> {
  if (!sandboxId) return;

  const { attachSandbox } = await import("../provider");

  try {
    const sandbox: SandboxHandle = await attachSandbox(sandboxId);
    await sandbox.destroy();
  } catch {
    // TTL is the backstop; a mission that already has a result must not fail
    // because the cleanup call did.
  }
}

export type CollectedFile = {
  path: string;
  content: string;
  original: string | null;
};

/**
 * Everything the workspace changed, as whole files.
 *
 * `git status --porcelain=v1 -z` inside the throwaway repository is the list;
 * the content comes from the sandbox and the base text from GitHub at the
 * pinned commit. Excluded directories are skipped before they can inflate the
 * patch, and the same 40-file / 400 KB caps a verification run uses apply.
 */
export async function collectFromSandbox(input: {
  sandbox: SandboxHandle;
  repo: string;
  baseSha: string;
  token: string;
  readBase: (path: string) => Promise<string | null>;
}): Promise<
  | { ok: true; files: CollectedFile[]; bytes: number }
  | { ok: false; reason: "patch_too_large" | "collect_failed"; detail: string }
> {
  const status = await input.sandbox.exec(
    "git status --porcelain=v1 -z -- .",
    MISSION_WORKDIR,
    60_000
  );

  if (status.exitCode !== 0) {
    return {
      ok: false,
      reason: "collect_failed",
      detail: `git status exited ${status.exitCode}: ${status.output.slice(0, 400)}`,
    };
  }

  const excluded = /(^|\/)(node_modules|\.next|dist|build|target|vendor|\.venv|__pycache__|\.git)(\/|$)/;
  const seen = new Set<string>();

  for (const entry of status.output.split("\0")) {
    const trimmed = entry.trim();
    if (trimmed.length < 4) continue;

    // "XY path" or "XY old -> new" in the non-z format; with -z the rename's
    // source arrives as its own NUL-terminated field, so the first path is the
    // one on disk.
    const path = trimmed.slice(3).replace(/^"|"$/g, "");
    if (path.length === 0 || excluded.test(path)) continue;
    if (path.startsWith("openmi-workspace/")) continue;

    seen.add(path);
  }

  if (seen.size > EXEC_MAX_FILES) {
    return {
      ok: false,
      reason: "patch_too_large",
      detail: `${seen.size} files changed; a mission collects at most ${EXEC_MAX_FILES}.`,
    };
  }

  const files: CollectedFile[] = [];
  let bytes = 0;

  for (const path of seen) {
    let content = "";

    try {
      content = await input.sandbox.readText(`${MISSION_WORKDIR}/${path}`, 400_000);
    } catch {
      // A path git reports but the sandbox cannot open is a deletion, which is
      // a legitimate change and is represented by empty content.
      content = "";
    }

    const original = await input.readBase(path).catch(() => null);

    if (original === null && content.length === 0) continue;

    bytes += Buffer.byteLength(content, "utf8") + Buffer.byteLength(original ?? "", "utf8");

    if (bytes > EXEC_MAX_PATCH_BYTES) {
      return {
        ok: false,
        reason: "patch_too_large",
        detail: `the collected change is over ${EXEC_MAX_PATCH_BYTES} bytes.`,
      };
    }

    files.push({ path, content, original });
  }

  return { ok: true, files, bytes };
}
