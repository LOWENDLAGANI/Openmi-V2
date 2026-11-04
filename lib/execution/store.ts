import "server-only";

import { settleExecutionDew } from "@/lib/dew/store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

import { EXEC_MAX_MINUTES, EXEC_RESERVE_DEW } from "./cost";
import type {
  ExecutionEventRow,
  ExecutionRunRow,
  ExecutionStage,
  ExecutionStatus,
  FailureCode,
} from "./status";

/**
 * Reads and writes for execution runs.
 *
 * Reads use the request's own client, so the owner policies in
 * `016_execution.sql` decide what is visible. Writes use the service role,
 * because a client may read its runs and may not author them: a run row is the
 * record of something that happened on a server, not a claim a browser gets to
 * make.
 */

type SessionClient = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;
type AdminClient = NonNullable<ReturnType<typeof supabaseAdmin>>;

/** A run older than this without a heartbeat is not running any more. */
const STALE_AFTER_MS = (EXEC_MAX_MINUTES + 5) * 60_000;

export async function clearStaleRuns(admin: AdminClient, owner: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data } = await admin
    .from("execution_runs")
    .select("id, sandbox_id")
    .eq("owner", owner)
    .in("status", ["queued", "running"])
    .lt("started_at", cutoff);

  const stale = (data ?? []) as Array<{ id: string; sandbox_id: string | null }>;

  for (const run of stale) {
    // A run that had a sandbox kept paying until the TTL removed it, so the
    // reservation stands. A run that never reached `provision` is refunded in
    // full: nothing ran, so nothing is owed.
    const charged = run.sandbox_id ? EXEC_RESERVE_DEW : 0;

    await admin
      .from("execution_runs")
      .update({
        status: "failed",
        failure_code: "crashed",
        failure_detail:
          "The server stopped reporting before this run finished. The sandbox self-destructs on its TTL.",
        charged_dew: charged,
        ended_at: new Date().toISOString(),
      })
      .eq("owner", owner)
      .eq("id", run.id)
      .in("status", ["queued", "running"]);

    await settleExecutionDew(admin, owner, run.id, charged);
  }
}

export async function createRun(
  admin: AdminClient,
  input: {
    /** Generated before the reservation, so the ledger can reference it. */
    id: string;
    owner: string;
    chatId: string;
    changesetId: string;
    repo: string;
    baseSha: string;
    reservedDew: number;
  }
): Promise<string> {
  const { data, error } = await admin
    .from("execution_runs")
    .insert({
      id: input.id,
      owner: input.owner,
      chat_id: input.chatId,
      changeset_id: input.changesetId,
      repo_full_name: input.repo,
      base_sha: input.baseSha,
      status: "queued",
      stage: "provision",
      reserved_dew: input.reservedDew,
      heartbeat_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "The run could not be recorded.");
  }

  return String((data as { id: string }).id);
}

export async function updateRun(
  admin: AdminClient,
  runId: string,
  patch: {
    status?: ExecutionStatus;
    stage?: ExecutionStage;
    failure_code?: FailureCode | null;
    failure_detail?: string | null;
    sandbox_id?: string | null;
    install_command?: string | null;
    build_command?: string | null;
    exit_code?: number | null;
    duration_ms?: number | null;
    charged_dew?: number;
    ended_at?: string | null;
  },
  options: { onlyWhileLive?: boolean } = {}
): Promise<void> {
  let query = admin
    .from("execution_runs")
    .update({ ...patch, heartbeat_at: new Date().toISOString() })
    .eq("id", runId);

  // A cancelled run is terminal. The runner still settles what it used, but it
  // must not overwrite the cancellation with "done" when the build finishes.
  if (options.onlyWhileLive) {
    query = query.in("status", ["queued", "running"]);
  }

  await query;
}

export async function appendEvent(
  admin: AdminClient,
  input: {
    runId: string;
    owner: string;
    seq: number;
    kind: "status" | "step" | "output" | "observation";
    body: string;
  }
): Promise<void> {
  // 4 KiB per event, enforced here rather than by a column type: a build log
  // is a tail, not an archive.
  const body = input.body.slice(0, 4_000);

  await admin.from("execution_events").insert({
    run_id: input.runId,
    owner: input.owner,
    seq: input.seq,
    kind: input.kind,
    body,
  });
}

export async function readRunForChangeset(
  supabase: SessionClient,
  changesetId: string
): Promise<ExecutionRunRow | null> {
  const { data } = await supabase
    .from("execution_runs")
    .select(
      "id, changeset_id, status, stage, failure_code, failure_detail, install_command, build_command, exit_code, duration_ms, reserved_dew, charged_dew, started_at, ended_at, heartbeat_at"
    )
    .eq("changeset_id", changesetId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const row = data as unknown as Record<string, unknown>;

  return {
    ...(row as unknown as ExecutionRunRow),
    reserved_dew: Number(row.reserved_dew ?? 0),
    charged_dew: Number(row.charged_dew ?? 0),
  };
}

export async function readEvents(
  supabase: SessionClient,
  runId: string
): Promise<ExecutionEventRow[]> {
  const { data } = await supabase
    .from("execution_events")
    .select("seq, at, kind, body")
    .eq("run_id", runId)
    .order("seq", { ascending: true })
    .limit(200);

  return (data ?? []) as ExecutionEventRow[];
}

/** The newest run for a changeset, read with the session client. */
export type RunOwnerView = {
  id: string;
  owner: string;
  status: ExecutionStatus;
  sandbox_id: string | null;
  started_at: string;
};

export async function readRunForOwner(
  supabase: SessionClient,
  runId: string
): Promise<RunOwnerView | null> {
  const { data } = await supabase
    .from("execution_runs")
    .select("id, owner, status, sandbox_id, started_at")
    .eq("id", runId)
    .maybeSingle();

  return (data as RunOwnerView | null) ?? null;
}
