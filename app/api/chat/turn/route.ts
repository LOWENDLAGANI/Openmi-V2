import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  RUN_HEARTBEAT_STALE_MS,
  RUN_PROGRESS_EVENTS,
  RUN_QUEUE_WAIT_MS,
} from "@/lib/runs/limits";
import { readEventsSince, settleStalledRuns } from "@/lib/runs/store";
import { wakeWorker } from "@/lib/runs/wake";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AgentStep } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a live run has already done, rebuilt from its own event log.
 *
 * A tab that reloaded is not reading the stream, so without this the wait is one
 * sentence — "still working on the server" — for a run that may already have
 * read six files and written half its answer. These are the same rows the stream
 * replays from `Last-Event-ID`, so what the reload shows is the run, not a
 * description of it.
 */
const MAX_PROGRESS_PAGES = 10;

async function readRunProgress(
  admin: SupabaseClient,
  runId: string
): Promise<{ text: string; thinking: string; steps: AgentStep[] }> {
  const steps: AgentStep[] = [];
  // `tool.finished` names the tool, not the sentence its start carried, so the
  // pair is joined by name — exactly as the streaming tab joins them.
  const summaries = new Map<string, string>();
  let text = "";
  let thinking = "";
  let afterSeq = 0;

  for (let page = 0; page < MAX_PROGRESS_PAGES; page += 1) {
    const events = await readEventsSince(
      admin,
      runId,
      afterSeq,
      RUN_PROGRESS_EVENTS
    ).catch(() => []);

    if (events.length === 0) break;

    for (const event of events) {
      afterSeq = Math.max(afterSeq, event.seq);
      const payload = event.payload;

      if (event.kind === "message.delta") {
        if (typeof payload.text === "string") text += payload.text;
        continue;
      }

      if (event.kind === "message.reasoning") {
        if (typeof payload.text === "string") thinking += payload.text;
        continue;
      }

      if (event.kind === "tool.started") {
        const tool = typeof payload.name === "string" ? payload.name : "tool";
        const detail =
          typeof payload.summary === "string" ? payload.summary : tool;
        const command =
          typeof payload.command === "string" ? payload.command : undefined;
        summaries.set(tool, detail);
        steps.push({
          tool,
          detail,
          state: "start",
          ...(command ? { command } : {}),
          offset: text.length,
        });
        continue;
      }

      if (event.kind === "tool.finished") {
        const tool = typeof payload.name === "string" ? payload.name : "tool";
        const detail = summaries.get(tool) ?? tool;
        const finished: AgentStep = {
          tool,
          detail,
          state: payload.isError === true ? "error" : "done",
          output:
            typeof payload.resultPreview === "string"
              ? payload.resultPreview
              : undefined,
        };

        let index = -1;
        for (let i = steps.length - 1; i >= 0; i -= 1) {
          if (steps[i].state === "start" && steps[i].tool === tool) {
            index = i;
            break;
          }
        }

        if (index >= 0) steps[index] = { ...steps[index], ...finished };
        else steps.push({ ...finished, offset: text.length });
      }
    }

    if (events.length < RUN_PROGRESS_EVENTS) break;
  }

  return { text, thinking, steps };
}

/**
 * Whether this chat still has a run being answered.
 *
 * The client polls this while it thinks work is happening elsewhere. It is what
 * makes "close the tab, come back" honest: the worker writes the answer, and the
 * transcript refreshes when the run settles instead of showing a question with
 * no reply forever.
 *
 * It is also where a run that nothing is going to finish stops being "in
 * progress". A worker that died — or a deployment with no worker at all — leaves
 * its row in the one-live-run index, and an already-open tab has no other reader
 * that would ever end the wait. So the poll settles the account's stalls with
 * the same service-role call the chat route makes before queuing work, applies
 * the same two ages the page applies to its spinner, and hands back the reason
 * when the last run stopped without an answer.
 */
export async function GET(request: Request) {
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json(
      { running: false },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const chatId = new URL(request.url).searchParams.get("chatId") ?? "";

  if (chatId.length === 0) {
    return NextResponse.json(
      { running: false },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const admin = supabaseAdmin();

  // Scoped to this account and idempotent: a queued run nobody claimed and a
  // running one whose heartbeat stopped are marked failed with their reason.
  if (admin) await settleStalledRuns(admin, session.user.id);

  const { data } = await session.supabase
    .from("runs")
    .select("id, status")
    .eq("chat_id", chatId)
    .in("status", ["queued", "running"])
    .or(
      `and(status.eq.queued,created_at.gte.${new Date(
        Date.now() - RUN_QUEUE_WAIT_MS
      ).toISOString()}),and(status.eq.running,heartbeat_at.gte.${new Date(
        Date.now() - RUN_HEARTBEAT_STALE_MS
      ).toISOString()})`
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as { id?: string; status?: string } | null;

  if (row?.id) {
    // Keep nudging a sleeping worker while the run is still waiting in the queue.
    if (row.status === "queued") wakeWorker();

    // The work so far, so a reload shows the steps and the answer in progress
    // instead of a spinner that says nothing about what the run is doing.
    const progress = admin
      ? await readRunProgress(admin, row.id)
      : { text: "", steps: [] };

    return NextResponse.json(
      {
        running: true,
        turnId: row.id,
        status: row.status ?? null,
        ...progress,
      },
      { headers: { "cache-control": "no-store" } }
    );
  }

  // Nothing is live, so the tab that was waiting is about to refresh. Say what
  // the last run was and, when it stopped without an answer, why — the reason
  // is the difference between a failed turn and a transcript that looks empty.
  const { data: last } = await session.supabase
    .from("runs")
    .select("id, status, error")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ended = last as
    | { id?: string; status?: string; error?: string | null }
    | null;

  // A leftover the settle above could not age out (for example, a deployment
  // whose database predates the function) is still not work in progress: it is
  // past the same ages the page reads, so it gets the same sentence.
  const stalled =
    ended?.status === "queued"
      ? "No worker picked this run up. Start it again."
      : ended?.status === "running"
        ? "The worker stopped reporting before this run finished. Start it again."
        : null;

  return NextResponse.json(
    {
      running: false,
      turnId: ended?.id ?? null,
      status: ended?.status ?? null,
      error: ended?.error ?? stalled,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
