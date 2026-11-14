import { NextResponse } from "next/server";

import {
  isTerminalEvent,
  parseLastEventId,
  runIsLive,
  sseFrame,
  sseHeartbeat,
  sseOpen,
} from "@/lib/runs/events";
import {
  RUN_STREAM_HEARTBEAT_MS,
  RUN_STREAM_MAX_MS,
  RUN_STREAM_POLL_MS,
} from "@/lib/runs/limits";
import {
  isTerminalStatus,
  readEventsSince,
  readRun,
  readRunForReader,
} from "@/lib/runs/store";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The event stream, over plain fetch rather than EventSource.
 *
 * The run is executed by the worker and never by this request, so this handler
 * is a reader of the append-only `run_events` log. That makes three things
 * true at once:
 *
 *   - closing the tab changes nothing about the run;
 *   - a reload resumes from `Last-Event-ID` and replays exactly what was missed;
 *   - the same frames are produced for a live run and a finished one.
 *
 * A heartbeat comment every 15 seconds keeps a proxy from closing a stream that
 * is quiet because the agent is installing dependencies. The stream closes after
 * a terminal event, or after `RUN_STREAM_MAX_MS` and lets the client reconnect.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json(
      { error: "Sign in." },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }

  const admin = supabaseAdmin();

  if (!admin) {
    return NextResponse.json(
      { error: "This deployment cannot read run events." },
      { status: 503, headers: { "cache-control": "no-store" } }
    );
  }

  const run = await readRunForReader(session.supabase, id);

  if (!run) {
    return NextResponse.json(
      { error: "That run does not exist." },
      { status: 404, headers: { "cache-control": "no-store" } }
    );
  }

  const url = new URL(request.url);
  const cursor = parseLastEventId(
    request.headers.get("last-event-id") ?? url.searchParams.get("after")
  );

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      send(sseOpen());

      let after = cursor;
      let lastWrite = Date.now();
      let terminalDeadline: number | null = null;
      const endsAt = Date.now() + RUN_STREAM_MAX_MS;

      try {
        while (!closed && !request.signal.aborted && Date.now() < endsAt) {
          const events = await readEventsSince(admin, id, after, 200);

          if (events.length > 0) {
            let terminal = false;

            for (const event of events) {
              send(sseFrame(event));
              after = Math.max(after, event.seq);
              if (isTerminalEvent(event.kind)) terminal = true;
            }

            lastWrite = Date.now();

            if (terminal) break;
            continue;
          }

          const fresh = await readRun(admin, id);

          if (!fresh) break;

          // The status is written before the terminal event. Give the append a
          // moment to land rather than closing on a stream that is one row away
          // from `run.finished`.
          if (isTerminalStatus(fresh.status) && !runIsLive(fresh.status)) {
            terminalDeadline ??= Date.now();
            if (Date.now() - terminalDeadline > 5_000) break;
          } else {
            terminalDeadline = null;
          }

          if (Date.now() - lastWrite >= RUN_STREAM_HEARTBEAT_MS) {
            send(sseHeartbeat());
            lastWrite = Date.now();
          }

          await new Promise((resolve) => setTimeout(resolve, RUN_STREAM_POLL_MS));
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // The reader went away; the run carries on in the worker.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
