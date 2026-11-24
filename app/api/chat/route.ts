import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { readAdminAccess } from "@/lib/admin/access";
import { MAX_MESSAGE_CHARS } from "@/lib/chat-limits";
import { titleFromMessage } from "@/lib/chat-title";
import { formatCredit } from "@/lib/credits";
import {
  grantTrialCredit,
  readCreditProfile,
  refundCreditSession,
  startCreditSession,
  type CreditGate,
} from "@/lib/credits/store";
import { executionConfigured, serverEnv } from "@/lib/env";
import { pullChatBranch } from "@/lib/execution/sync/session";
import { isRepoFullName, getRepo, resolveBranchSha } from "@/lib/github/read";
import { readToken } from "@/lib/github/token";
import { hashIp, requestIp } from "@/lib/http/ip";
import { isSameOrigin } from "@/lib/http/origin";
import { appendMessage, listMessages, recentHistory } from "@/lib/messages";
import {
  adminOnlyRefusal,
  effortOrDefault,
  firstAvailableModel,
  hasModel,
  modelRequiresAdmin,
  modelRequiresPaid,
  modelSupportsEffort,
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
  RUN_STREAM_HEARTBEAT_MS,
  checkRunQuota,
} from "@/lib/runs/limits";
import {
  appendRunMessages,
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

/**
 * Stop cleanly before a 60 s serverless ceiling and hand the reader the run's
 * id + cursor so the client seamlessly opens the next window without dropping
 * the stream on 60 s hosts (e.g. Vercel Hobby) or mobile proxies.
 */
const WINDOW_MS = 50_000;
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
  /**
   * A continuation's place in that run's event log: the last seq the reader
   * actually received. Without it the next window starts at the run's newest
   * event and everything written during the handover is never delivered.
   */
  cursor?: unknown;
  /** The thinking effort this message asked for, for the model that takes one. */
  effort?: unknown;
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

    // Resume exactly where the reader stopped rather than at the run's newest
    // event. Deltas and steps are written while one window closes and the next
    // opens; starting at `last_event_seq` dropped them, which is a sentence
    // vanishing mid-answer. A cursor past the log is clamped, so a stale or
    // forged value can only replay what this run really wrote.
    const resumeAt =
      typeof body.cursor === "number" && Number.isFinite(body.cursor)
        ? Math.min(Math.max(0, Math.trunc(body.cursor)), run.last_event_seq)
        : run.last_event_seq;

    return streamRun({
      admin,
      session,
      chatId,
      run,
      cursor: resumeAt,
      greeting: null,
    });
  }

  const modelOptions = modelCatalogue();
  const model: ModelId = hasModel(modelOptions, body.model)
    ? (body.model as string)
    : firstAvailableModel(modelOptions);

  // The effort is the reader's choice for the model that takes one. A model with
  // no effort setting records nothing, rather than a level that would never be
  // sent and would make the row claim a decision nobody made.
  const effort = modelSupportsEffort(model)
    ? effortOrDefault(body.effort)
    : null;

  // A paid-only model is judged before a chat row, an hour or a message exists:
  // a refused send costs nothing and leaves nothing behind. The hour trigger in
  // 051 refuses it again, so a caller that forgets this check cannot spend it.
  if (modelRequiresPaid(model, modelOptions)) {
    const profile = await readCreditProfile(session.supabase, session.user.id);
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

    // Always resolve the branch's live HEAD on GitHub when creating a chat so a
    // draft inheriting an older chat's repo_base_sha never starts behind the
    // remote branch. Fall back to the supplied sha only if GitHub cannot be read.
    if (requestedRepo) {
      try {
        const github = await readToken(session.supabase, session.user.id);
        if (github) {
          if (!requestedBranch) {
            requestedBranch = (await getRepo(github.token, requestedRepo)).defaultBranch;
          }
          const latestSha = await resolveBranchSha(
            github.token,
            requestedRepo,
            requestedBranch
          );
          if (latestSha) requestedSha = latestSha;
        }
      } catch {
        // Keep any validated fallback sha, or leave unattached if none.
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

  // The trial grant and the chat lookup are independent reads of two different
  // tables, so they travel together: awaiting the grant first put a whole round
  // trip between the request and the gate it feeds.
  const sealKey = serverEnv().githubTokenKey;
  const callerIp = requestIp(request.headers);

  const trialGrant =
    callerIp && sealKey
      ? grantTrialCredit(admin, session.user.id, hashIp(callerIp, sealKey))
      : Promise.resolve(0);

  const [{ data: chat, error }] = await Promise.all([
    session.supabase
      .from("chats")
      .select("id, repo_full_name, repo_branch, repo_base_sha")
      .eq("id", chatId)
      .maybeSingle(),
    trialGrant,
  ]);

  if (error) return json({ error: error.message }, 500);
  if (!chat) return json({ error: "That chat does not exist." }, 404);

  const repoFullName =
    typeof chat.repo_full_name === "string" && isRepoFullName(chat.repo_full_name)
      ? chat.repo_full_name
      : null;
  const repoBranch =
    typeof chat.repo_branch === "string" && chat.repo_branch.trim().length > 0
      ? chat.repo_branch.trim()
      : null;
  let sha = typeof chat.repo_base_sha === "string" ? chat.repo_base_sha : null;

  // Keep existing chats up to date with their remote branch before queuing a
  // turn: if the branch moved ahead and the workspace has no uncommitted files,
  // advance the pin so openChatSandbox reseeds fresh. Uncommitted work or
  // transient GitHub errors leave the current pin intact.
  if (!createdChat && repoFullName && repoBranch) {
    try {
      const github = await readToken(session.supabase, session.user.id);
      if (github) {
        const pulled = await pullChatBranch({
          admin,
          supabase: session.supabase,
          chatId,
          token: github.token,
        });
        if (pulled.ok && pulled.verdict === "pull") {
          sha = pulled.head;
        }
      }
    } catch {
      // Best-effort sync; proceed with the existing pinned sha.
    }
  }

  // Trial Credit is granted above, not at signup: this is the first point in
  // the flow where the request has an address, and the grant is capped per
  // address per day. It settles before the gate below reads the balance.

  // Charged once per running hour, and the database reuses a live hour, so a
  // second message inside it costs nothing. A refusal here happens before any
  // row is written.
  const credit: CreditGate = await startCreditSession(session.supabase, model, repoFullName, {
    chatId,
  });

  if (!credit.ok) {
    return json(
      { error: credit.error, code: credit.code, activeChatId: credit.activeChatId },
      credit.code === "hour-active" ? 409 : 402
    );
  }

  // The hour is charged before the run exists, so every path from here to a
  // queued run is a path that may owe the reader their Credit back: they paid
  // for a turn that never started. Only an hour this request bought is given
  // back — an hour that was already running was paid for by an earlier message,
  // and the worker owns the refund decision for that one. The refund also ends
  // the hour, so the time cannot stay while the Credit returns.
  const refundChargedHour = async (reason: string) => {
    if (!credit.session.started || !credit.session.sessionId) return;

    await refundCreditSession(
      admin,
      session.user.id,
      credit.session.sessionId,
      reason
    ).catch(() => false);
  };

  let userMessage = null;

  try {
    // Writing the message and ageing out the account's leftover runs touch
    // different rows; running them together saves a round trip on every send.
    [userMessage] = await Promise.all([
      appendMessage(session.supabase, chatId, "user", content, model),
      settleStalledRuns(admin, session.user.id),
    ]);
  } catch (caught) {
    await refundChargedHour("the message was not saved");

    return json(
      { error: caught instanceof Error ? caught.message : "The message was not saved." },
      500
    );
  }

  if (!userMessage) {
    await refundChargedHour("the message was not saved");

    return json({ error: "The message was not saved." }, 500);
  }

  // A worker that died — or a deployment with no worker at all — leaves its run
  // in the one-live-run index, which would refuse every new chat with "you
  // already have a run in progress" for good. Its leftovers were aged out above,
  // before the quota is asked, so a leftover is not a permanent lockout.
  const [quota, transcript] = await Promise.all([
    readQuota(admin, session.user.id),
    listMessages(session.supabase, chatId),
  ]);
  const decision = checkRunQuota(quota);

  if (!decision.allowed) {
    // The hour was charged a moment ago and no run will start: the quota is
    // advice about what this account may do, not something it can be billed for.
    await refundChargedHour("the turn was over the account's quota");

    return json(
      { error: decision.message, code: decision.code, quota },
      decision.code === "concurrency" ? 409 : 402
    );
  }

  const runId = randomUUID();
  const history = recentHistory(transcript);

  const queueRun = () =>
    createRun(admin, {
      id: runId,
      owner: session.user.id,
      chatId,
      repo: repoFullName,
      baseSha: sha,
      prompt: content,
      model,
      effort,
      creditSessionId: credit.session.sessionId,
    });

  let run: RunRow;

  try {
    run = await queueRun();
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "The message could not be queued.";

    if (!/duplicate key|unique/i.test(message)) {
      await refundChargedHour("the turn could not be queued");

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
        await refundChargedHour("the turn could not be queued");

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

      await refundChargedHour("another turn was already running");

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

  // The conversation behind the message travels with the run: the worker builds
  // its model call from these rows, so the answer remembers the chat without
  // the chat route having to run anything. One call, in order — a call per row
  // was up to twelve sequential round trips before the stream could open.
  await appendRunMessages(
    admin,
    runId,
    history.map((message) => ({ role: message.role, text: message.content }))
  );

  // A worker on a host that sleeps without traffic does not know this row
  // exists until something reaches it, and nothing on this host does. One ping
  // per queued run is what makes the run start on its own instead of waiting
  // for someone to open the worker's health URL. It is sent after the history
  // is written, so a woken worker cannot claim a run whose transcript is still
  // arriving.
  wakeWorker();

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
    credit,
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
  credit?: Extract<CreditGate, { ok: true }>;
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
      /** When this stream last wrote a byte, so a silent run keeps it open. */
      let lastWrite = Date.now();

      const send = (event: string, data: unknown) => {
        if (closed) return;
        lastWrite = Date.now();
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

      if (input.credit) {
        if (input.credit.session.started) {
          send("credit", {
            charged: true,
            mode: input.credit.session.mode,
            price: input.credit.session.price,
            balance: input.credit.session.balance,
            wallet: input.credit.session.wallet,
            combined: input.credit.session.combined,
            label: `Started an hour of chat: ${formatCredit(input.credit.session.price)} Credit charged. Balance ${formatCredit(input.credit.session.balance)}.`,
          });
        }
      }

      // The assistant row this run will write, if it writes one, is the first
      // one after this seq. Capturing it here keeps a previous answer from being
      // reported as the result of a run that produced nothing.
      let lastAssistantSeqBefore = 0;
      try {
        const { data: before } = await session.supabase
          .from("messages")
          .select("seq")
          .eq("chat_id", chatId)
          .eq("role", "assistant")
          .order("seq", { ascending: false })
          .limit(1)
          .maybeSingle();
        const seq = (before as { seq?: number } | null)?.seq;
        if (typeof seq === "number") lastAssistantSeqBefore = seq;
      } catch {
        lastAssistantSeqBefore = 0;
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

          // The model's chain of thought, on its own channel. The panel keeps
          // it apart from the answer and folds it, so it is never mistaken for
          // something the assistant said.
          if (event.kind === "message.reasoning") {
            const text = typeof payload.text === "string" ? payload.text : "";
            if (text.length > 0) send("reasoning", { text });
            continue;
          }

          if (event.kind === "tool.started") {
            const name = typeof payload.name === "string" ? payload.name : "tool";
            const summary =
              typeof payload.summary === "string" ? payload.summary : name;
            const command =
              typeof payload.command === "string" ? payload.command : undefined;

            summaries.set(name, summary);
            send("step", {
              tool: name,
              detail: summary,
              state: "start",
              ...(command ? { command } : {}),
            });
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

            if (fresh?.status === "queued") {
              // Keep nudging a sleeping worker while the run is still queued,
              // in case the first 1.5s wake ping landed during a cold boot.
              wakeWorker();
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
          // The cursor travels with the token, so the next window continues from
          // the reader's own place in the log instead of from the newest event.
          send("paused", { turn: run.id, cursor });
          close();
          return;
        }

        // A run can be silent for minutes while a build or an install grinds.
        // A stream that writes nothing is closed by proxies that never see a
        // byte, which looked like a dropped turn; a comment line keeps it open
        // and every SSE reader ignores it.
        if (Date.now() - lastWrite >= RUN_STREAM_HEARTBEAT_MS) {
          lastWrite = Date.now();
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch {
            closed = true;
          }
        }

        await sleep(POLL_MS);
      }

      // The worker writes the answer (and its proposed diff) before it emits
      // `run.finished`, so both reads below are racing nothing.
      const { data: stored } = await session.supabase
        .from("messages")
        .select("id, seq, content, thinking, steps")
        .eq("chat_id", chatId)
        .eq("role", "assistant")
        .order("seq", { ascending: false })
        .limit(1)
        .maybeSingle();

      send("changeset", {});

      const row = stored as {
        id?: string;
        seq?: number;
        content?: string | null;
        thinking?: string | null;
        steps?: unknown;
      } | null;

      // Only a row newer than the one that existed before this run started
      // counts as this run's answer. Otherwise a failed run with no message
      // would be reported with a previous turn's text.
      const isNewAssistant =
        typeof row?.seq === "number" && row.seq > lastAssistantSeqBefore;
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
      } else if (!sawError || isNewAssistant) {
        send("done", {
          id: isNewAssistant ? row?.id ?? `assistant-${run.id}` : `assistant-${run.id}`,
          seq: isNewAssistant && typeof row?.seq === "number" ? row.seq : null,
          // The transcript is the source of truth: the answer and its reasoning
          // come from the row the worker wrote, not from the stream a tab may
          // have missed. Steps ride along when the worker stored them. A run
          // that produced no stored answer carries nothing from an earlier turn.
          content: isNewAssistant && typeof row?.content === "string" ? row.content : null,
          thinking: isNewAssistant && typeof row?.thinking === "string" ? row.thinking : null,
          steps: isNewAssistant && Array.isArray(row?.steps) ? row.steps : null,
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
