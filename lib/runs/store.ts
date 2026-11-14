import type { SupabaseClient } from "@supabase/supabase-js";

import type { RunEventRow } from "./events";
import { RUN_STALE_AFTER_MS } from "./limits";

/**
 * Reads and writes for runs.
 *
 * Deliberately free of `server-only`, `next/*` and the request context: the
 * worker is a plain Node/Bun process and imports this module directly. The app
 * passes a request-scoped client (RLS decides visibility) for reads and the
 * service-role client for the few writes it performs. The worker passes the
 * service-role client and *always* filters by the run's recorded owner.
 */

export type RunStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "blocked";

export const TERMINAL_STATUSES: readonly RunStatus[] = [
  "done",
  "failed",
  "cancelled",
  "blocked",
];

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export type RunRow = {
  id: string;
  owner: string;
  chat_id: string | null;
  repo_full_name: string | null;
  base_sha: string | null;
  prompt: string;
  model: string;
  status: RunStatus;
  stop_reason: string | null;
  error: string | null;
  sandbox_id: string | null;
  worker_id: string | null;
  steps: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cancel_requested: boolean;
  /** The charged hour a chat turn will be refunded against if it fails. */
  dew_session_id: string | null;
  last_event_seq: number;
  created_at: string;
  started_at: string | null;
  heartbeat_at: string | null;
  ended_at: string | null;
};

export type RunMessageRow = {
  idx: number;
  role: "user" | "assistant" | "tool" | "system";
  content_json: Record<string, unknown>;
  tags: string[];
  created_at: string;
};

export type RunStepRow = {
  idx: number;
  input_tokens: number;
  output_tokens: number;
  finish_reason: string | null;
  tool_names: string[];
  duration_ms: number | null;
  created_at: string;
};

export type RunToolCallRow = {
  step_idx: number;
  idx: number;
  name: string;
  args_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  is_error: boolean;
  duration_ms: number | null;
};

export type RunArtifactRow = {
  id: string;
  path: string;
  kind: "file" | "diff" | "log";
  storage_key: string;
  bytes: number;
  sha256: string | null;
  created_at: string;
};

export type RunSnapshot = {
  run: RunRow;
  messages: RunMessageRow[];
  steps: RunStepRow[];
  toolCalls: RunToolCallRow[];
  artifacts: RunArtifactRow[];
};

type Client = SupabaseClient;

function normalizeRun(row: Record<string, unknown>): RunRow {
  return {
    ...(row as unknown as RunRow),
    steps: Number(row.steps ?? 0),
    input_tokens: Number(row.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens ?? 0),
    cost_usd: Number(row.cost_usd ?? 0),
    last_event_seq: Number(row.last_event_seq ?? 0),
    cancel_requested: Boolean(row.cancel_requested),
  };
}

export const RUN_COLUMNS =
  "id, owner, chat_id, repo_full_name, base_sha, prompt, model, status, stop_reason, error, sandbox_id, worker_id, steps, input_tokens, output_tokens, cost_usd, cancel_requested, dew_session_id, last_event_seq, created_at, started_at, heartbeat_at, ended_at";

export async function createRun(
  admin: Client,
  input: {
    id: string;
    owner: string;
    chatId: string | null;
    repo: string | null;
    baseSha: string | null;
    prompt: string;
    model: string;
    /** Set by a chat turn: the hour that is refunded if the run fails. */
    dewSessionId?: string | null;
  }
): Promise<RunRow> {
  const { data, error } = await admin
    .from("runs")
    .insert({
      id: input.id,
      owner: input.owner,
      chat_id: input.chatId,
      repo_full_name: input.repo,
      base_sha: input.baseSha,
      prompt: input.prompt,
      model: input.model,
      dew_session_id: input.dewSessionId ?? null,
      status: "queued",
    })
    .select(RUN_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "The run could not be recorded.");
  }

  return normalizeRun(data as Record<string, unknown>);
}

/** Claims one queued run, or null when the queue is empty. */
export async function claimNextRun(
  admin: Client,
  workerId: string
): Promise<RunRow | null> {
  const { data, error } = await admin.rpc("claim_next_run", {
    p_worker: workerId,
  });

  if (error) throw new Error(error.message);

  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | null;

  return row ? normalizeRun(row) : null;
}

export async function readRun(admin: Client, runId: string): Promise<RunRow | null> {
  const { data, error } = await admin
    .from("runs")
    .select(RUN_COLUMNS)
    .eq("id", runId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? normalizeRun(data as Record<string, unknown>) : null;
}

/** A read through the reader's own client: RLS is the authority here. */
export async function readRunForReader(
  supabase: Client,
  runId: string
): Promise<RunRow | null> {
  const { data, error } = await supabase
    .from("runs")
    .select(RUN_COLUMNS)
    .eq("id", runId)
    .maybeSingle();

  if (error || !data) return null;
  return normalizeRun(data as Record<string, unknown>);
}

export async function updateRun(
  admin: Client,
  runId: string,
  patch: {
    status?: RunStatus;
    stop_reason?: string | null;
    error?: string | null;
    sandbox_id?: string | null;
    steps?: number;
    input_tokens?: number;
    output_tokens?: number;
    cost_usd?: number;
    ended_at?: string | null;
    heartbeat_at?: string | null;
  },
  options: {
    onlyWhileRunning?: boolean;
    onlyWhileQueued?: boolean;
    workerId?: string;
  } = {}
): Promise<void> {
  let query = admin.from("runs").update(patch).eq("id", runId);

  if (options.onlyWhileRunning) query = query.eq("status", "running");
  if (options.onlyWhileQueued) query = query.eq("status", "queued");
  if (options.workerId) query = query.eq("worker_id", options.workerId);

  await query;
}

/** Refreshes the lease. False means this worker no longer owns the run. */
export async function heartbeat(
  admin: Client,
  runId: string,
  workerId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("runs")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("worker_id", workerId)
    .eq("status", "running")
    .select("id");

  return !error && Array.isArray(data) && data.length > 0;
}

export async function cancelRequested(
  admin: Client,
  runId: string
): Promise<boolean> {
  const { data } = await admin
    .from("runs")
    .select("cancel_requested, status")
    .eq("id", runId)
    .maybeSingle();

  const row = data as { cancel_requested?: boolean; status?: string } | null;
  if (!row) return true;
  if (row.status && isTerminalStatus(row.status)) return true;
  return Boolean(row.cancel_requested);
}

/** Appends one event and returns its sequence number. */
export async function appendEvent(
  admin: Client,
  runId: string,
  kind: string,
  payload: Record<string, unknown> = {}
): Promise<number | null> {
  const { data, error } = await admin.rpc("append_run_event", {
    p_run: runId,
    p_kind: kind,
    p_payload: payload,
  });

  if (error) return null;
  return typeof data === "number" ? data : null;
}

/**
 * The transcript a run was seeded with, in order.
 *
 * A chat turn arrives with the conversation behind it: the route writes the
 * recent messages here before the worker claims the run, and the loop builds
 * its model call from them instead of starting cold. Empty for a run started
 * without history, which is why the loop falls back to the prompt.
 */
export async function listRunMessages(
  admin: Client,
  runId: string
): Promise<{ role: "user" | "assistant"; text: string }[]> {
  const { data, error } = await admin
    .from("run_messages")
    .select("idx, role, content_json")
    .eq("run_id", runId)
    .order("idx", { ascending: true });

  if (error || !data) return [];

  const out: { role: "user" | "assistant"; text: string }[] = [];

  for (const row of data as Record<string, unknown>[]) {
    const role = String(row.role);
    if (role !== "user" && role !== "assistant") continue;

    const content = (row.content_json ?? {}) as { text?: unknown };
    const text = typeof content.text === "string" ? content.text : "";
    if (text.trim().length === 0) continue;

    out.push({ role, text });
  }

  return out;
}

export async function appendRunMessage(
  admin: Client,
  runId: string,
  role: RunMessageRow["role"],
  content: Record<string, unknown>,
  tags: string[] = []
): Promise<number | null> {
  const { data, error } = await admin.rpc("append_run_message", {
    p_run: runId,
    p_role: role,
    p_content: content,
    p_tags: tags,
  });

  if (error) return null;
  return typeof data === "number" ? data : null;
}

/**
 * Starts one step, by compare-and-set on the run row.
 *
 * Null means the run is no longer running or was cancelled between steps. That
 * is the point: nothing may be spent on a run whose row says stop.
 */
export async function beginStep(
  admin: Client,
  runId: string,
  hashes: { system: string; messages: string }
): Promise<number | null> {
  const { data, error } = await admin.rpc("begin_run_step", {
    p_run: runId,
    p_system_hash: hashes.system,
    p_messages_hash: hashes.messages,
  });

  if (error) return null;
  return typeof data === "number" ? data : null;
}

export async function finishStep(
  admin: Client,
  runId: string,
  idx: number,
  patch: {
    input_tokens: number;
    output_tokens: number;
    finish_reason: string;
    tool_names: string[];
    duration_ms: number;
  }
): Promise<void> {
  await admin
    .from("run_steps")
    .update({
      input_tokens: patch.input_tokens,
      output_tokens: patch.output_tokens,
      finish_reason: patch.finish_reason,
      tool_names: patch.tool_names,
      duration_ms: patch.duration_ms,
    })
    .eq("run_id", runId)
    .eq("idx", idx);
}

export async function appendToolCall(
  admin: Client,
  input: {
    runId: string;
    stepIdx: number;
    idx: number;
    name: string;
    args: Record<string, unknown> | null;
    result: Record<string, unknown>;
    isError: boolean;
    durationMs: number;
  }
): Promise<void> {
  await admin.rpc("append_run_tool_call", {
    p_run: input.runId,
    p_step_idx: input.stepIdx,
    p_idx: input.idx,
    p_name: input.name,
    p_args: input.args,
    p_result: input.result,
    p_is_error: input.isError,
    p_duration_ms: input.durationMs,
  });
}

export async function requestRunCancel(
  admin: Client,
  runId: string,
  owner: string
): Promise<boolean> {
  const { data, error } = await admin.rpc("request_run_cancel", {
    p_run: runId,
    p_owner: owner,
  });

  return !error && data === true;
}

export async function readQuota(
  admin: Client,
  owner: string
): Promise<{ active: number; runsToday: number; tokensToday: number }> {
  const { data, error } = await admin.rpc("run_quota", { p_owner: owner });

  const row = (Array.isArray(data) ? data[0] : data) as
    | { active?: unknown; runs_today?: unknown; tokens_today?: unknown }
    | null;

  if (error || !row) return { active: 0, runsToday: 0, tokensToday: 0 };

  return {
    active: Number(row.active ?? 0),
    runsToday: Number(row.runs_today ?? 0),
    tokensToday: Number(row.tokens_today ?? 0),
  };
}

export async function recordRunUsage(
  admin: Client,
  owner: string,
  tokensIn: number,
  tokensOut: number,
  costUsd: number
): Promise<void> {
  await admin.rpc("record_run_usage", {
    p_owner: owner,
    p_tokens_in: Math.max(0, Math.trunc(tokensIn)),
    p_tokens_out: Math.max(0, Math.trunc(tokensOut)),
    p_cost: costUsd,
  });
}

/** Recent runs for the signed-in reader; RLS decides whose rows these are. */
export async function listRuns(
  supabase: Client,
  limit = 20
): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from("runs")
    .select(RUN_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(normalizeRun);
}

export async function readEventsSince(
  admin: Client,
  runId: string,
  afterSeq: number,
  limit = 200
): Promise<RunEventRow[]> {
  const { data, error } = await admin
    .from("run_events")
    .select("seq, kind, payload, at")
    .eq("run_id", runId)
    .gt("seq", Math.max(0, Math.trunc(afterSeq)))
    .order("seq", { ascending: true })
    .limit(limit);

  if (error || !data) return [];

  return (data as Record<string, unknown>[]).map((row) => ({
    seq: Number(row.seq),
    kind: String(row.kind),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    at: String(row.at ?? ""),
  }));
}

/**
 * Everything a reload needs, in one read.
 *
 * The run row is read with the reader's client first: if RLS refuses it, the
 * rest of the query set is never reached. That is what makes "not found" and
 * "not yours" the same answer.
 */
export async function readSnapshot(
  supabase: Client,
  runId: string
): Promise<RunSnapshot | null> {
  const run = await readRunForReader(supabase, runId);
  if (!run) return null;

  const [messages, steps, toolCalls, artifacts] = await Promise.all([
    supabase
      .from("run_messages")
      .select("idx, role, content_json, tags, created_at")
      .eq("run_id", runId)
      .order("idx", { ascending: true })
      .limit(500),
    supabase
      .from("run_steps")
      .select("idx, input_tokens, output_tokens, finish_reason, tool_names, duration_ms, created_at")
      .eq("run_id", runId)
      .order("idx", { ascending: true })
      .limit(200),
    supabase
      .from("run_tool_calls")
      .select("step_idx, idx, name, args_json, result_json, is_error, duration_ms")
      .eq("run_id", runId)
      .order("step_idx", { ascending: true })
      .order("idx", { ascending: true })
      .limit(400),
    supabase
      .from("run_artifacts")
      .select("id, path, kind, storage_key, bytes, sha256, created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  return {
    run,
    messages: (messages.data ?? []) as RunMessageRow[],
    steps: ((steps.data ?? []) as Record<string, unknown>[]).map((row) => ({
      idx: Number(row.idx),
      input_tokens: Number(row.input_tokens ?? 0),
      output_tokens: Number(row.output_tokens ?? 0),
      finish_reason: (row.finish_reason as string | null) ?? null,
      tool_names: (row.tool_names as string[] | null) ?? [],
      duration_ms: row.duration_ms === null ? null : Number(row.duration_ms),
      created_at: String(row.created_at ?? ""),
    })),
    toolCalls: (toolCalls.data ?? []) as RunToolCallRow[],
    artifacts: ((artifacts.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      path: String(row.path),
      kind: row.kind as RunArtifactRow["kind"],
      storage_key: String(row.storage_key),
      bytes: Number(row.bytes ?? 0),
      sha256: (row.sha256 as string | null) ?? null,
      created_at: String(row.created_at ?? ""),
    })),
  };
}

/**
 * Settles the account's runs that nothing is going to finish.
 *
 * The one-live-run index refuses every new run while a leftover row sits in it,
 * so a dead worker used to lock an account out of chatting permanently. This
 * asks the database to age out that account's stalls before new work is queued:
 * a queued run nobody claimed, a running run whose heartbeat stopped. Returns
 * how many were settled. Never throws — a failure here must not refuse a chat.
 */
export async function settleStalledRuns(
  admin: Client,
  owner: string
): Promise<number> {
  const { data, error } = await admin.rpc("settle_stalled_runs", {
    p_owner: owner,
  });

  if (error) return 0;
  return Array.isArray(data) ? data.length : 0;
}

/**
 * A run whose worker stopped reporting is not running any more.
 *
 * The reaper is a safety net for a worker crash, and it runs from the worker's
 * own start and from the cron route. A run that was mid-sandbox is marked
 * failed; the orphan sweep destroys the box, because the provider deadline is
 * a backstop rather than a plan.
 *
 * A run left in `queued` is settled too: no worker ever claimed it, so it is
 * not work in progress — it is a row holding the one-live-run index.
 */
export async function reapStaleRuns(
  admin: Client,
  olderThanMs: number = RUN_STALE_AFTER_MS
): Promise<string[]> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();

  const [runningResult, queuedResult] = await Promise.all([
    admin
      .from("runs")
      .select("id, owner")
      .eq("status", "running")
      // A heartbeat is written the moment a run is claimed, so a null one is a
      // row that never really started; without this branch it was immortal.
      .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`)
      .lt("created_at", cutoff)
      .limit(50),
    admin
      .from("runs")
      .select("id, owner")
      .eq("status", "queued")
      .lt("created_at", cutoff)
      .limit(50),
  ]);

  const running = (runningResult.data ?? []) as Array<{
    id: string;
    owner: string;
  }>;
  const queued = (queuedResult.data ?? []) as Array<{
    id: string;
    owner: string;
  }>;

  for (const run of running) {
    await updateRun(
      admin,
      run.id,
      {
        status: "failed",
        stop_reason: "error",
        error:
          "The worker stopped reporting before this run finished. Its sandbox is destroyed by the sweep.",
        ended_at: new Date().toISOString(),
      },
      { onlyWhileRunning: true }
    );

    await appendEvent(admin, run.id, "run.error", {
      code: "worker-lost",
      message: "The worker stopped reporting. Start a new run.",
      retryable: true,
    });
  }

  for (const run of queued) {
    await updateRun(
      admin,
      run.id,
      {
        status: "failed",
        stop_reason: "error",
        error: "No worker picked this run up. Start it again.",
        ended_at: new Date().toISOString(),
      },
      { onlyWhileQueued: true }
    );

    await appendEvent(admin, run.id, "run.error", {
      code: "never-claimed",
      message: "No worker picked this run up. Start it again.",
      retryable: true,
    });
  }

  return [...running, ...queued].map((run) => run.id);
}

/** Runs stuck in `queued` are handed back to the queue by age, not deleted. */
export async function countLiveRuns(admin: Client): Promise<number> {
  const { count } = await admin
    .from("runs")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "running"]);

  return count ?? 0;
}
