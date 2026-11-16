import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { readAdminAccess } from "@/lib/admin/access";
import { MAX_MESSAGE_CHARS } from "@/lib/chat-limits";
import { titleFromMessage } from "@/lib/chat-title";
import { formatDew } from "@/lib/dew";
import {
  grantTrialDew,
  readDewProfile,
  startDewSession,
  type DewGate,
} from "@/lib/dew/store";
import { executionConfigured, serverEnv } from "@/lib/env";
import { isRepoFullName, getRepo, resolveBranchSha } from "@/lib/github/read";
import { readToken } from "@/lib/github/token";
import { hashIp, requestIp } from "@/lib/http/ip";
import { isSameOrigin } from "@/lib/http/origin";
import { appendMessage, listMessages, recentHistory } from "@/lib/messages";
import {
  adminOnlyRefusal,
  firstAvailableModel,
  hasModel,
  modelRequiresAdmin,
  modelRequiresPaid,
  paidOnlyRefusal,
  type ModelId,
} from "@/lib/models";
import { modelCatalogue, providersConfigured } from "@/lib/providers";
import { firstSignalIn, recordRiskSignal } from "@/lib/moderation/record";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  RUN_HEARTBEAT_STALE_MS,
  RUN_QUEUE_NOTICE_MS,
  RUN_QUEUE_WAIT_MS,
  checkRunQuota,
} from "@/lib/runs/limits";
import {
  appendRunMessage,
  createRun,
  readEventsSince,
  readQuota,
  settleStalledRuns,
  readRun,
  type RunRow,
} from "@/lib/runs/store";
import { wakeWorker } from "@/lib/runs/wake";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The stream's window is 240 s, so the invocation's ceiling is 300 s. */
export const maxDuration = 300;

/**
 * A chat message, executed as a run.
 *
 * The request does three things and then gets out of the way: it writes the
 * question to the transcript, queues a run for the worker, and streams the run's
 * events back in the shape the chat already understands. Nothing about the
 * answer happens inside this invocation, so closing the tab cannot interrupt it
 * and a deployment cannot cut it in half.
 *
 * The stream is a view over `run_events`, which means a reload can replay it and
 * a long run can be picked up again: the window closes before the function's
 * ceiling and sends `paused` with the run id, and the client continues from
 * there. No work is duplicated, because nothing in this route produces work.
 */

/** Stop well before the 300 s ceiling and hand the reader the run's id. */
const WINDOW_MS = 240_000;
const POLL_MS = 250;
/** How many idle polls between re-reads of the run row: six seconds. */
const ROW_CHECK_TICKS = 24;
/** Idle polls before a never-claimed run is admitted: twenty seconds. */
const NOTICE_TICKS = Math.ceil(RUN_QUEUE_NOTICE_MS / POLL_MS);

type ChatRequest = {
  chatId?: unknown;
  content?: unknown;
  model?: unknown;
  path?: unknown;
  /** A continuation: the run the client is already watching. */
  turn?: unknown;
  repo?: unknown;
  branch?: unknown;
  sha?: unknown;
};

function json(
  body: unknown,
  status: number,
  extra: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", ...extra },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminal(status: string): boolean {
  return status !== "queued" && status !== "running";
}

/**
 * True when the row has outlived the queue's own rule.
 *
 * The page bounds its spinner with the same two ages, and the poll that drives
 * a reloaded tab settles with them. This is the stream's copy: without it a run
 * nothing will claim stays "in progress" for as long as the reader is willing
 * to wait, which is the whole of forever.
 */
function stalledFor(run: RunRow): boolean {
  const created = Date.parse(run.created_at);
  const beat = Date.parse(run.heartbeat_at ?? run.started_at ?? run.created_at);

  if (run.status === "queued") {
    return Number.isFinite(created) && Date.now() - created >= RUN_QUEUE_WAIT_MS;
  }

  if (run.status === "running") {
    return Number.isFinite(beat) && Date.now() - beat >= RUN_HEARTBEAT_STALE_MS;
  }

  return false;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return json({ error: "That request came from another origin." }, 403);
  }

  const session = await getSession();

  if (session.state === "unconfigured") {
    return json({ error: "Supabase is not configured on this deployment." }, 503);
  }

  if (session.state !== "signed-in") return json({ error: "Sign in to chat." }, 401);

  const limited = await checkRateLimit(supabaseAdmin(), "chat", session.user.id);

  if (!limited.allowed) {
    // One row per window, not one per refused request: the feed is for a person
    // to read, and a hammering client is a single fact about an account.
    if (firstSignalIn(`chat-rate:${session.user.id}`, 10 * 60_000)) {
      void recordRiskSignal({
        userId: session.user.id,
        kind: "rate-limit",
        severity: "medium",
        summary: `Chat rate limit tripped (${limited.limit}/min), refusals continue`,
        detail: { retryAfterSeconds: limited.retryAfterSeconds },
        route: "POST /api/chat",
      });
    }

    return json(
      {
        error: `Too many messages. Try again in ${limited.retryAfterSeconds} seconds.`,
        code: "rate-limited",
      },
      429,
      { "retry-after": String(limited.retryAfterSeconds) }
    );
  }

  const body = (await request.json().catch(() => null)) as ChatRequest | null;

  if (!body) return json({ error: "Malformed request." }, 400);

  const continuationId = typeof body.turn === "string" ? body.turn : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!continuationId) {
    if (content.length === 0) return json({ error: "Write something first." }, 400);
    if (content.length > MAX_MESSAGE_CHARS) {
      return json(
        { error: `A message is capped at ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` },
        413
      );
    }
  }

  if (!providersConfigured()) {
    return json(
      {
        error: "Openmi can't answer right now. Try again in a moment.",
        code: "no-provider",
      },
      409
    );
  }

  // A chat turn runs in a sandbox, because the agent is the thing behind it.
  // Saying so before a row exists is better than queueing a run that can only
  // fail: the message names the missing configuration, not a generic error.
  if (!executionConfigured()) {
    return json(
      {
        error:
          "The agent needs its execution provider configured (E2B_API_KEY) before it can answer.",
        code: "no-execution",
      },
      409
    );
  }

  const admin = supabaseAdmin();

  if (!admin) {
    return json(
      { error: "This deployment has no service role key, so the agent cannot run." },
      503
    );
  }

  let chatId =
    typeof body.chatId === "string" && body.chatId.length > 0 ? body.chatId : "";

  // ── A continuation: the same run, the next window ─────────────────────────
  if (continuationId) {
    if (chatId.length === 0) {
      return json({ error: "A continuation needs its chat." }, 400);
    }

    const run = await readRun(admin, continuationId).catch(() => null);

    if (!run || run.owner !== session.user.id || run.chat_id !== chatId) {
      return json({ error: "That run does not exist." }, 404);
    }

    return streamRun({
      admin,
      session,
      chatId,
      run,
      cursor: run.last_event_seq,
      greeting: null,
    });
  }

  const modelOptions = modelCatalogue();
  const model: ModelId = hasModel(modelOptions, body.model)
    ? (body.model as string)
    : firstAvailableModel(modelOptions);

  // A paid-only model is judged before a chat row, an hour or a message exists:
  // a refused send costs nothing and leaves nothing behind. The hour trigger in
  // 051 refuses it again, so a caller that forgets this check cannot spend it.
  if (modelRequiresPaid(model, modelOptions)) {
    const profile = await readDewProfile(session.supabase, session.user.id);
    const refusal = paidOnlyRefusal(
      model,
      profile?.paidActive === true,
      modelOptions
    );

    if (refusal) return json(refusal, 402);
  }

  // The operator-only model is refused in the same place and for the same
  // reason: before a chat row, an hour or a message exists. Hiding it in the
  // picker is the display half, not the gate.
  if (modelRequiresAdmin(model, modelOptions)) {
    const access = await readAdminAccess();
    const refusal = adminOnlyRefusal(
      model,
      access.state === "admin",
      modelOptions
    );

    if (refusal) return json(refusal, 403);
  }

  // ── A new message ─────────────────────────────────────────────────────────
  let createdChat = false;

  if (chatId.length === 0) {
    // Created on the first message, not when "New chat" is clicked. An empty
    // chat is not a conversation, and it should not appear in history.
    const requestedRepo =
      typeof body.repo === "string" && isRepoFullName(body.repo.trim())
        ? body.repo.trim()
        : "";

    let requestedBranch = typeof body.branch === "string" ? body.branch.trim() : "";
    let requestedSha =
      typeof body.sha === "string" && /^[0-9a-f]{40}$/i.test(body.sha.trim())
        ? body.sha.trim()
        : "";

    // The pin is resolved on the server when the draft did not carry one, so the
    // sha in the database is one GitHub reported, not one a form supplied.
    if (requestedRepo && (!requestedBranch || !requestedSha)) {
      try {
        const github = await readToken(session.supabase, session.user.id);
        if (github) {
          if (!requestedBranch) {
            requestedBranch = (await getRepo(github.token, requestedRepo)).defaultBranch;
          }
          if (!requestedSha) {
            requestedSha = await resolveBranchSha(
              github.token,
              requestedRepo,
              requestedBranch
            );
          }
        }
      } catch {
        // A repository that cannot be read is not attached.
      }
    }

    const pin =
      requestedRepo && requestedBranch && requestedSha
        ? {
            repo_full_name: requestedRepo,
            repo_branch: requestedBranch,
            repo_base_sha: requestedSha,
          }
        : {};

    const { data: created, error: createError } = await session.supabase
      .from("chats")
      .insert({
        owner: session.user.id,
        title: titleFromMessage(content),
        charge_mode: "hour",
        ...pin,
      })
      .select("id")
      .single();

    if (createError || !created) {
      return json({ error: createError?.message ?? "Could not start a chat." }, 500);
    }

    chatId = String((created as { id: string }).id);
    createdChat = true;
  }

  const { data: chat, error } = await session.supabase
    .from("chats")
    .select("id, repo_full_name, repo_base_sha")
    .eq("id", chatId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!chat) return json({ error: "That chat does not exist." }, 404);

  const repoFullName =
    typeof chat.repo_full_name === "string" && isRepoFullName(chat.repo_full_name)
      ? chat.repo_full_name
      : null;
  const sha = typeof chat.repo_base_sha === "string" ? chat.repo_base_sha : null;

  const sealKey = serverEnv().githubTokenKey;

  // Trial Dew is granted here, not at signup: this is the first point in the
  // flow where the request has an address, and the grant is capped per address
  // per day.
  const callerIp = requestIp(request.headers);

  if (callerIp && sealKey) {
    await grantTrialDew(admin, session.user.id, hashIp(callerIp, sealKey));
  }

  // Charged once per running hour, and the database reuses a live hour, so a
  // second message inside it costs nothing. A refusal here happens before any
  // row is written.
  const dew: DewGate = await startDewSession(session.supabase, model, repoFullName, {
    chatId,
  });

  if (!dew.ok) {
    return json(
      { error: dew.error, code: dew.code, activeChatId: dew.activeChatId },
      dew.code === "hour-active" ? 409 : 402
    );
  }

  let userMessage = null;

  try {
    userMessage = await appendMessage(session.supabase, chatId, "user", content, model);
  } catch (caught) {
    return json(
      { error: caught instanceof Error ? caught.message : "The message was not saved." },
      500
    );
  }

  if (!userMessage) return json({ error: "The message was not saved." }, 500);

  // A worker that died — or a deployment with no worker at all — leaves its run
  // in the one-live-run index, which would refuse every new chat with "you
  // already have a run in progress" for good. Age the account's leftovers out
  // before asking the quota, so a leftover is not a permanent lockout.
  await settleStalledRuns(admin, session.user.id);

  const quota = await readQuota(admin, session.user.id);
  const decision = checkRunQuota(quota);

  if (!decision.allowed) {
    return json(
      { error: decision.message, code: decision.code, quota },
      decision.code === "concurrency" ? 409 : 402
    );
  }

  const runId = randomUUID();
  const history = recentHistory(await listMessages(session.supabase, chatId));

  const queueRun = () =>
    createRun(admin, {
      id: runId,
      owner: session.user.id,
      chatId,
      repo: repoFullName,
      baseSha: sha,
      prompt: content,
      model,
      dewSessionId: dew.session.sessionId,
    });

  let run: RunRow;

  try {
    run = await queueRun();
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "The message could not be queued.";

    if (!/duplicate key|unique/i.test(message)) {
      return json({ error: message }, 500);
    }

    // The row holding the index may itself have gone stale between the check
    // above and this insert. Settle again and retry once: if the retry is also
    // refused, the other run really is live and the 409 is the truth.
    await settleStalledRuns(admin, session.user.id);

    try {
      run = await queueRun();
    } catch (retry) {
      const again =
        retry instanceof Error ? retry.message : "The message could not be queued.";

      if (!/duplicate key|unique/i.test(again)) {
        return json({ error: again }, 500);
      }

      if (firstSignalIn(`run-concurrency:${session.user.id}`, 10 * 60_000)) {
        void recordRiskSignal({
          userId: session.user.id,
          kind: "run-concurrency",
          severity: "low",
          summary: "Started a second run while one was live",
          detail: { chatId },
          route: "POST /api/chat",
        });
      }

      return json(
        {
          error:
            "You already have a run in progress. Wait for it to finish, or stop it first.",
          code: "concurrency",
        },
        409
      );
    }
  }

  // A worker on a host that sleeps without traffic does not know this row
  // exists until something reaches it, and nothing on this host does. One ping
  // per queued run is what makes the run start on its own instead of waiting
  // for someone to open the worker's health URL.
  wakeWorker();

  // The conversation behind the message travels with the run: the worker builds
  // its model call from these rows, so the answer remembers the chat without
  // the chat route having to run anything.
  for (const message of history) {
    await appendRunMessage(admin, runId, message.role, {
      text: message.content,
    }).catch(() => null);
  }

  const greeting = createdChat ? chatId : null;

  return streamRun({
    admin,
    session,
    chatId,
    run,
    cursor: 0,
    greeting,
    userMessage: userMessage
      ? { id: userMessage.id, seq: Number(userMessage.seq) }
      : null,
    dew,
  });
}

type StreamInput = {
  admin: NonNullable<ReturnType<typeof supabaseAdmin>>;
  session: Extract<Awaited<ReturnType<typeof getSession>>, { state: "signed-in" }>;
  chatId: string;
  run: RunRow;
  cursor: number;
  greeting: string | null;
  userMessage?: { id: string; seq: number } | null;
  dew?: Extract<DewGate, { ok: true }>;
};

/**
 * Translates a run's event log into the chat's stream.
 *
 * The names the panel knows (`delta`, `step`, `done`) are the contract with the
 * existing conversation UI. The runtime's own vocabulary stays in the database;
 * what crosses the wire is only what a transcript can show.
 */
function streamRun(input: StreamInput): NextResponse {
  const { admin, session, chatId, run } = input;
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let cursor = input.cursor;
      let terminalStatus: string | null = null;
      let sawError = false;
      /** The row read, when the stream ends on a settled run rather than an event. */
      let settled: RunRow | null = null;
      let toldAboutQueue = false;
      let settleTried = false;
      const summaries = new Map<string, string>();

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The reader went away; the run is unaffected.
        }
      };

      if (input.greeting) send("chat", { id: input.greeting });
      if (input.userMessage) send("user", input.userMessage);

      if (input.dew) {
        if (input.dew.session.started) {
          send("dew", {
            charged: true,
            mode: input.dew.session.mode,
            price: input.dew.session.price,
            balance: input.dew.session.balance,
            wallet: input.dew.session.wallet,
            combined: input.dew.session.combined,
            label: `Started an hour of chat: ${formatDew(input.dew.session.price)} Dew charged. Balance ${formatDew(input.dew.session.balance)}.`,
          });
        }
      }

      const deadline = Date.now() + WINDOW_MS;
      let idle = 0;

      while (!closed) {
        let events: Awaited<ReturnType<typeof readEventsSince>> = [];

        try {
          events = await readEventsSince(admin, run.id, cursor, 200);
        } catch {
          events = [];
        }

        for (const event of events) {
          cursor = Math.max(cursor, event.seq);
          idle = 0;

          const payload = event.payload as Record<string, unknown>;

          if (event.kind === "message.delta") {
            const text = typeof payload.text === "string" ? payload.text : "";
            if (text.length > 0) send("delta", { text });
            continue;
          }

          if (event.kind === "tool.started") {
            const name = typeof payload.name === "string" ? payload.name : "tool";
            const summary =
              typeof payload.summary === "string" ? payload.summary : name;

            summaries.set(name, summary);
            send("step", { tool: name, detail: summary, state: "start" });
            continue;
          }

          if (event.kind === "tool.finished") {
            const name = typeof payload.name === "string" ? payload.name : "tool";
            const preview =
              typeof payload.resultPreview === "string" ? payload.resultPreview : "";
            const failed = payload.isError === true;

            send("step", {
              tool: name,
              detail: summaries.get(name) ?? name,
              state: failed ? "error" : "done",
              output: preview,
            });
            continue;
          }

          if (event.kind === "warning") {
            const message = typeof payload.message === "string" ? payload.message : "";
            if (message.length > 0) send("notice", { message });
            continue;
          }

          // The write is the app's, and it happens before the run settles. The
          // reader gets the branch and the pull request as a sentence in the
          // transcript instead of a card they would have to click.
          if (event.kind === "changeset.applied") {
            const summary =
              typeof payload.summary === "string"
                ? payload.summary
                : "The change was written to GitHub.";
            send("notice", { message: summary });
            send("changeset", {});
            continue;
          }

          if (event.kind === "run.finished") {
            terminalStatus =
              typeof payload.status === "string" ? payload.status : "done";
            continue;
          }

          if (event.kind === "run.error") {
            terminalStatus = "failed";
            sawError = true;
            send("error", {
              message:
                typeof payload.message === "string"
                  ? payload.message
                  : "The agent could not finish.",
            });
            continue;
          }
        }

        if (terminalStatus) break;

        // A worker that died leaves the row in the queue until something
        // settles it; the row is the authority on that, not this stream's
        // patience. It is re-read every six idle seconds, and a row past the
        // queue's own age is settled here — the same service-role call the chat
        // route makes before it queues work — so the wait ends with a reason.
        if (events.length === 0) {
          idle += 1;

          if (idle % ROW_CHECK_TICKS === 0) {
            let fresh = await readRun(admin, run.id).catch(() => null);

            if (fresh && !terminal(fresh.status) && stalledFor(fresh) && !settleTried) {
              settleTried = true;
              await settleStalledRuns(admin, session.user.id);
              fresh = await readRun(admin, run.id).catch(() => null);
            }

            // Silence after twenty seconds is not "thinking": no worker has
            // claimed the run. Saying so beats a spinner that will not move,
            // and the composer's Stop settles a queued run on the spot.
            if (
              fresh?.status === "queued" &&
              !toldAboutQueue &&
              idle >= NOTICE_TICKS
            ) {
              toldAboutQueue = true;
              send("notice", {
                message: `Queued — no worker has picked this run up yet. It is failed automatically after ${Math.round(
                  RUN_QUEUE_WAIT_MS / 60_000
                )} minutes; Stop ends it now.`,
              });
            }

            if (fresh && terminal(fresh.status) && cursor >= fresh.last_event_seq) {
              terminalStatus = fresh.status;
              settled = fresh;
              break;
            }
          }
        }

        if (Date.now() > deadline) {
          send("paused", { turn: run.id });
          close();
          return;
        }

        await sleep(POLL_MS);
      }

      // The worker writes the answer (and its proposed diff) before it emits
      // `run.finished`, so both reads below are racing nothing.
      const { data: stored } = await session.supabase
        .from("messages")
        .select("id, seq")
        .eq("chat_id", chatId)
        .eq("role", "assistant")
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle();

      send("changeset", {});

      const row = stored as { id?: string; seq?: number } | null;
      const stopped =
        terminalStatus === "cancelled"
          ? "aborted"
          : terminalStatus === "blocked"
            ? "partial"
            : undefined;

      // A run settled by the reaper has no terminal event of its own, so its
      // reason is read from the row. Sending `done` instead put an empty answer
      // on screen and left the reader without the one fact that mattered: that
      // nothing had run.
      const settledMessage =
        settled === null
          ? null
          : (settled.error ??
            (settled.status === "failed"
              ? "The run failed before it answered."
              : null));

      if (settledMessage) {
        send("error", { message: settledMessage });
      } else if (!sawError || row?.id) {
        send("done", {
          id: row?.id ?? `assistant-${run.id}`,
          seq: typeof row?.seq === "number" ? row.seq : null,
          ...(stopped ? { stopped } : {}),
          status: terminalStatus ?? "done",
        });
      }

      close();
    },
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
