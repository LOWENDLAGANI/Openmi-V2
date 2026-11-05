import { after, NextResponse } from "next/server";

import {
  MAX_STEPS,
  TURN_TTL_MS,
  hashPrompt,
  newTurnId,
  signEnvelope,
  verifyEnvelope,
} from "@/lib/agent/envelope";
import { runAgent } from "@/lib/agent/run";
import type { EditRequest } from "@/lib/changesets";
import { readAutoApproval } from "@/lib/changesets/autoapproval";
import { approveChangesetAndOpenPullRequest } from "@/lib/changesets/commit";
import {
  addEdits,
  createChangeset,
  finalizeChangeset,
  findDraftChangeset,
} from "@/lib/changesets/store";
import { assembleContext } from "@/lib/context";
import { formatDew } from "@/lib/dew";
import { refundReasonFor } from "@/lib/dew/refund";
import {
  refundDewSession,
  startDewSession,
  type ChargeMode,
  type DewGate,
} from "@/lib/dew/store";
import { executionConfigured, serverEnv } from "@/lib/env";
import {
  getFile,
  getRepo,
  getTree,
  isRepoFullName,
  MAX_PATH_INDEX,
  resolveBranchSha,
} from "@/lib/github/read";
import { readToken } from "@/lib/github/token";
import { appendMessage, listMessages, recentHistory } from "@/lib/messages";
import { DEFAULT_MODEL, hasModel, type ModelId } from "@/lib/models";
import { buildSystemPrompt } from "@/lib/prompt";
import {
  modelCatalogue,
  providerKeys,
  providersConfigured,
  providersFor,
  streamCompletion,
  type ChatMessage,
} from "@/lib/providers";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 20_000;

type ChatRequest = {
  chatId?: unknown;
  content?: unknown;
  model?: unknown;
  path?: unknown;
  turn?: unknown;
  /** "hour" or "request": how this message is paid for. */
  mode?: unknown;
  /** The repository a draft chat was started from, if any. */
  repo?: unknown;
  branch?: unknown;
  sha?: unknown;
};

function json(
  body: unknown,
  status: number,
  extra: Record<string, string> = {}
) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", ...extra },
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "That did not work.";
}

export async function POST(request: Request) {
  const session = await getSession();

  if (session.state === "unconfigured") {
    return json({ error: "Supabase is not configured on this deployment." }, 503);
  }

  if (session.state !== "signed-in") return json({ error: "Sign in to chat." }, 401);

  // Before the body is read and before any provider call: one shared counter per
  // account per minute. A degraded limiter allows the turn and reports itself on
  // /setup, rather than turning a missing variable into a failed request.
  const limited = await checkRateLimit(supabaseAdmin(), "chat", session.user.id);

  if (!limited.allowed) {
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

  const continuationToken = typeof body.turn === "string" ? body.turn : null;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const requestedMode: ChargeMode | null =
    body.mode === "request" ? "request" : body.mode === "hour" ? "hour" : null;

  let chatId =
    typeof body.chatId === "string" && body.chatId.length > 0 ? body.chatId : "";
  let createdChat = false;

  if (chatId.length === 0) {
    if (continuationToken) {
      return json({ error: "A continuation needs its chat." }, 400);
    }

    // Created on the first message, not when "New chat" is clicked. An empty
    // chat is not a conversation, and it should not appear in history.
    //
    // A draft started from a repository carries that repository into the row.
    // Without this, picking a repo and pressing "New chat" produced a chat with
    // no code attached, and the first answer had nothing to cite.
    const requestedRepo =
      typeof body.repo === "string" && isRepoFullName(body.repo.trim())
        ? body.repo.trim()
        : "";

    let requestedBranch = typeof body.branch === "string" ? body.branch.trim() : "";
    let requestedSha =
      typeof body.sha === "string" && /^[0-9a-f]{40}$/i.test(body.sha.trim())
        ? body.sha.trim()
        : "";

    // The pin is resolved on the server when the draft did not carry one, so
    // the sha in the database is one GitHub reported, not one a form supplied.
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
        // A repository that cannot be read is not attached. The message still
        // sends, and the workspace keeps saying there is no repository rather
        // than pinning a commit nobody verified.
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
      .insert({ owner: session.user.id, title: "New chat", charge_mode: requestedMode ?? "hour", ...pin })
      .select("id")
      .single();

    if (createError || !created) {
      return json(
        { error: createError?.message ?? "Could not start a chat." },
        500
      );
    }

    chatId = String((created as { id: string }).id);
    createdChat = true;
  }

  if (!continuationToken) {
    if (content.length === 0) return json({ error: "Write something first." }, 400);
    if (content.length > MAX_MESSAGE_CHARS) {
      return json(
        { error: `A message is capped at ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` },
        413
      );
    }
  }

  // An id the catalogue does not know — an old tab, a renamed custom entry —
  // falls back to auto instead of failing the turn.
  const model: ModelId = hasModel(modelCatalogue(), body.model)
    ? (body.model as string)
    : DEFAULT_MODEL;


  // RLS decides whether this chat exists for this account; the select is the
  // request, not a second authority.
  const { data: chat, error } = await session.supabase
    .from("chats")
    .select("id, repo_full_name, repo_base_sha, charge_mode, repo_branch")
    .eq("id", chatId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!chat) return json({ error: "That chat does not exist." }, 404);

  // A chat's first answer decides how the rest of it is paid for, so the mode
  // lives on the row rather than in the tab that typed the question.
  const chatChargeMode: ChargeMode =
    (chat as { charge_mode?: string }).charge_mode === "request"
      ? "request"
      : "hour";

  // The gate is before any provider call, not after. Nothing has been spent
  // when this returns, and the composer says so rather than failing silently.
  if (!providersConfigured()) {
    return json(
      {
        error:
          "No AI provider key is configured, so there is nothing to answer with. The setup page lists the keys.",
        code: "no-provider",
      },
      409
    );
  }

  const sealKey = serverEnv().githubTokenKey;

  let continuation: { turnId: string; steps: number; exp: number } | null = null;
  let turnChargeMode: ChargeMode = requestedMode ?? chatChargeMode;

  if (continuationToken) {
    if (!sealKey) {
      return json(
        { error: "Continuation tokens cannot be verified without GITHUB_TOKEN_KEY." },
        503
      );
    }

    const verified = verifyEnvelope(continuationToken, sealKey);

    if (!verified.ok) {
      return json(
        {
          error: "That continuation token is not valid for this deployment.",
          code: "turn-invalid",
        },
        409
      );
    }

    if (verified.payload.chatId !== chatId) {
      return json(
        { error: "That continuation token belongs to a different chat." },
        409
      );
    }

    // The row is the authority on steps. A token that claims a step count it no
    // longer has is a replay of a spent turn, and it is refused here.
    const { data: row, error: rowError } = await session.supabase
      .from("agent_turns")
      .select("turn_id, steps, expires_at, charge_mode")
      .eq("turn_id", verified.payload.turnId)
      .maybeSingle();

    if (rowError) return json({ error: rowError.message }, 500);
    if (!row) return json({ error: "That turn no longer exists." }, 409);

    if (Number(row.steps) !== verified.payload.steps) {
      return json(
        {
          error: "This turn was already continued or has moved on.",
          code: "turn-replay",
        },
        409
      );
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json({ error: "That turn expired." }, 409);
    }

    continuation = {
      turnId: verified.payload.turnId,
      steps: Number(row.steps),
      exp: verified.payload.exp,
    };

    turnChargeMode =
      (row as { charge_mode?: string }).charge_mode === "request"
        ? "request"
        : "hour";
  }

  // Charged only after the deployment can answer and after a continuation has
  // proved it belongs to this chat, so a bad token never costs anything. A
  // continuation of a per-request turn is the same request, not a second one,
  // so it is not charged again.
  let dew: DewGate;
  if (continuation && turnChargeMode === "request") {
    dew = {
      ok: true,
      session: {
        sessionId: "",
        started: false,
        expiresAt: "",
        balance: 0,
        wallet: 0,
        price: 0,
        mode: "request",
        combined: false,
      },
    };
  } else {
    dew = await startDewSession(
      session.supabase,
      model,
      typeof chat.repo_full_name === "string" ? chat.repo_full_name : null,
      { chatId, mode: turnChargeMode }
    );
  }

  if (!dew.ok) {
    return json(
      { error: dew.error, code: dew.code, activeChatId: dew.activeChatId },
      dew.code === "hour-active" ? 409 : 402
    );
  }

  const turnId = continuation?.turnId ?? newTurnId();
  const expiresAt = continuation ? continuation.exp : Date.now() + TURN_TTL_MS;

  if (continuation) {
    // A continuation is the same turn, so it is running again. Without this the
    // turn stays "paused" and the page cannot tell that work resumed.
    await session.supabase
      .from("agent_turns")
      .update({ status: "running", cancel_requested: false, finished_at: null })
      .eq("turn_id", turnId)
      .eq("owner", session.user.id);
  }

  let userMessage = null;

  if (!continuation) {
    // Persisted before the provider call: a failed answer leaves the question in
    // the transcript instead of erasing what the user typed.
    try {
      userMessage = await appendMessage(session.supabase, chatId, "user", content, model);
    } catch (caught) {
      return json({ error: messageOf(caught) }, 500);
    }

    if (!userMessage) return json({ error: "The message was not saved." }, 500);

    const { error: turnError } = await session.supabase.from("agent_turns").insert({
      turn_id: turnId,
      owner: session.user.id,
      chat_id: chatId,
      model,
      charge_mode: turnChargeMode,
      prompt_hash: hashPrompt(content),
      max_steps: MAX_STEPS,
      expires_at: new Date(expiresAt).toISOString(),
    });

    if (turnError) return json({ error: turnError.message }, 500);
  }

  const repoFullName =
    typeof chat.repo_full_name === "string" && isRepoFullName(chat.repo_full_name)
      ? chat.repo_full_name
      : null;
  const sha = typeof chat.repo_base_sha === "string" ? chat.repo_base_sha : null;

  let context = assembleContext({ paths: [], pinned: null });
  let paths: string[] = [];
  let githubToken: string | null = null;
  let repoFailed = false;

  if (repoFullName && sha) {
    try {
      const github = await readToken(session.supabase, session.user.id);

      if (!github) {
        repoFailed = true;
      } else {
        githubToken = github.token;

        const tree = await getTree(github.token, repoFullName, sha);
        paths = tree.entries
          .filter((entry) => entry.type === "blob")
          .map((entry) => entry.path)
          .slice(0, MAX_PATH_INDEX);

        const pinnedPath =
          typeof body.path === "string" && body.path.length > 0 ? body.path : null;

        const pinned = pinnedPath
          ? await getFile(github.token, repoFullName, sha, pinnedPath)
              .then((file) => ({ path: file.path, text: file.text }))
              .catch(() => null)
          : null;

        context = assembleContext({ paths, pinned });

        if (pinnedPath && !pinned) {
          context.notes.push(
            `The open file ${pinnedPath} could not be read at ${sha.slice(0, 7)}; it was not included.`
          );
        }
      }
    } catch (caught) {
      repoFailed = true;
      githubToken = null;
      context = assembleContext({ paths: [], pinned: null });
      context.notes.push(`The repository could not be read: ${messageOf(caught)}`);
    }
  }

  const history = recentHistory(await listMessages(session.supabase, chatId));

  const system = buildSystemPrompt({
    repo: repoFullName,
    sha,
    context: context.text,
    notes: context.notes,
    edits: Boolean(repoFullName && sha && sealKey),
    // The model is told what this deployment can actually do, so "do you have
    // a Linux environment" gets the true answer: a sandbox exists for a ready
    // diff, but not as a shell for this chat.
    sandbox: executionConfigured(),
  });

  const plainMessages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.map((message) => ({ role: message.role, content: message.content })),
  ];

  const userSeq = userMessage ? Number(userMessage.seq) : null;

  // A turn outlives the tab that started it. `after()` keeps this invocation
  // alive once the response is closed, so the answer is written down even when
  // nobody is listening any more. `maxDuration` is still the ceiling, which is
  // why the turn pauses at CONTINUE_AT_MS instead of running past it.
  let settleTurn: (() => void) | null = null;
  const turnFinished = new Promise<void>((resolve) => {
    settleTurn = resolve;
  });
  // The race is a backstop: an invocation that never reaches `finish` must not
  // hold the function open until the platform kills it.
  after(() =>
    Promise.race([
      turnFinished,
      new Promise<void>((resolve) => setTimeout(resolve, 60_000)),
    ])
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let settled = false;
      let turnText = "";

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

      // Generation is deliberately NOT wired to request.signal. Closing the
      // tab ends this stream, not the work. Only an explicit Stop — the
      // cancel_requested flag on the turn row, set by /api/chat/stop — aborts
      // the provider call, so "leave the page" and "stop" stay different acts.
      const abort = new AbortController();

      const finish = async (
        status: "done" | "error" | "paused",
        finalText: string
      ) => {
        if (settled) return;
        settled = true;
        closed = true;
        clearInterval(watcher);

        try {
          await session.supabase
            .from("agent_turns")
            .update({
              status,
              partial: finalText.slice(0, 20_000),
              finished_at: new Date().toISOString(),
            })
            .eq("turn_id", turnId)
            .eq("owner", session.user.id);
        } catch {
          // The answer is already stored as a message. A status write that
          // fails must not turn a finished turn into a broken stream.
        }

        try {
          controller.close();
        } catch {
          // The reader went away; the work above is what mattered.
        }

        settleTurn?.();
      };

      const watcher = setInterval(() => {
        if (abort.signal.aborted) return;

        void session.supabase
          .from("agent_turns")
          .select("cancel_requested")
          .eq("turn_id", turnId)
          .maybeSingle()
          .then(({ data }) => {
            const row = data as { cancel_requested?: boolean } | null;
            if (row?.cancel_requested) abort.abort();
          });
      }, 2_000);

      if (createdChat) send("chat", { id: chatId });

      if (userMessage && userSeq !== null) {
        send("user", { id: userMessage.id, seq: userSeq });
      }

      send("context", {
        usedChars: context.usedChars,
        budgetChars: context.budgetChars,
        notes: [
          ...context.notes,
          ...(repoFailed ? ["Repository reads failed for this turn."] : []),
        ],
      });

      // A charge is a fact the reader should see, not a silent balance change.
      // Sent only when something was actually charged: a turn inside a running
      // hour costs nothing and says nothing.
      if (dew.session.started) {
        send("dew", {
          charged: true,
          mode: dew.session.mode,
          price: dew.session.price,
          balance: dew.session.balance,
          wallet: dew.session.wallet,
          combined: dew.session.combined,
          label:
            dew.session.mode === "request"
              ? `Charged ${formatDew(dew.session.price)} Dew for this message. Balance ${formatDew(dew.session.balance)}.`
              : `Started an hour of chat: ${formatDew(dew.session.price)} Dew charged. Balance ${formatDew(dew.session.balance)}.`,
        });
      }

      const persist = (text: string) =>
        appendMessage(
          session.supabase,
          chatId,
          "assistant",
          text,
          model,
          Math.ceil(text.length / 4)
        );

      // A refund is only due for an hour charged by this request that produced
      // no answer at all. The database allows one refund per session.
      let refunded = false;

      const refundTurn = async (reason: string) => {
        if (refunded || !dew.session.started) return;
        refunded = true;

        const ok = await refundDewSession(
          session.supabase,
          dew.session.sessionId,
          reason
        );

        if (ok) {
          send("notice", {
            message: `Refunded automatically: ${reason.toLowerCase()}.`,
          });
        } else {
          send("notice", {
            message:
              "This hour could not be refunded automatically; the ledger still shows the charge.",
          });
        }
      };

      const startedAt = Date.now();

      // A proposal is a row, created on first use and signed when the turn
      // settles. A paused turn keeps its draft so the continuation adds to the
      // same card instead of starting a second one.
      let changesetId: string | null = null;
      let changesetFiles = 0;
      let changesetSettled = false;

      const propose = async (
        edits: EditRequest[]
      ): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
        if (!repoFullName || !sha || !githubToken) {
          return {
            ok: false,
            error: "no repository is pinned to this chat, so there is nothing to edit",
          };
        }

        if (!sealKey) {
          return {
            ok: false,
            error: "this deployment cannot sign a changeset without GITHUB_TOKEN_KEY",
          };
        }

        if (!changesetId) {
          changesetId = await findDraftChangeset(session.supabase, turnId);
        }

        if (!changesetId) {
          const created = await createChangeset(session.supabase, {
            owner: session.user.id,
            chatId,
            turnId,
            repo: repoFullName,
            baseSha: sha,
          });

          if (!created.ok) return { ok: false, error: created.error };
          changesetId = created.id;
        }

        const result = await addEdits(session.supabase, {
          changesetId,
          owner: session.user.id,
          token: githubToken,
          repo: repoFullName,
          sha,
          edits,
        });

        if (!result.ok) return { ok: false, error: result.error };

        changesetFiles += result.added;
        return { ok: true, text: result.text };
      };

      const settleChangeset = async () => {
        if (!changesetId || changesetSettled) return;
        changesetSettled = true;

        try {
          const finalized = await finalizeChangeset(session.supabase, {
            changesetId,
            baseSha: sha ?? "",
            sealKey: sealKey ?? null,
          });

          send("changeset", {
            id: changesetId,
            status: finalized.status,
            files: finalized.files,
          });

          // The build itself starts from the card, because it needs more time
          // than this function's 60 s ceiling allows. A ready diff is verified
          // automatically; a branch with a standing approval is written now
          // instead of waiting for that build.
          if (finalized.status === "ready" && githubToken) {
            const { data: chatRow } = await session.supabase
              .from("chats")
              .select("repo_branch")
              .eq("id", chatId)
              .maybeSingle();

            const chatRowValue = chatRow as { repo_branch?: string | null } | null;

            send("notice", {
              message:
                "This diff is built in a sandbox; a failing build is repaired, and a pull request opens only if it exits 0.",
            });

            if (sealKey && repoFullName) {
              const remembered = await readAutoApproval(session.supabase, {
                owner: session.user.id,
                repo: repoFullName,
                branch: chatRowValue?.repo_branch ?? "main",
              });

              if (remembered) {
                const approved = await approveChangesetAndOpenPullRequest(
                  session.supabase,
                  {
                    changesetId: changesetId as string,
                    owner: session.user.id,
                    sealKey,
                  }
                );

                send("notice", {
                  message: approved.ok
                    ? approved.prUrl
                      ? `Auto-approved on ${approved.branch}: ${approved.prUrl}`
                      : `Auto-approved on ${approved.branch}.`
                    : `The standing approval could not write this diff: ${approved.error}`,
                });

                if (approved.ok) {
                  send("changeset", {
                    id: changesetId,
                    status: "approved",
                    files: finalized.files,
                  });
                }
              }
            }
          }
        } catch (caught) {
          send("notice", {
            message: `The changeset could not be prepared: ${messageOf(caught)}`,
          });
        }
      };

      if (repoFullName && sha && githubToken) {
        const result = await runAgent({
          githubToken,
          repo: repoFullName,
          sha,
          paths,
          model,
          system,
          history: history.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          steps: continuation?.steps ?? 0,
          consume: async (expected) => {
            const { data, error: stepError } = await session.supabase.rpc(
              "consume_agent_step",
              { p_turn_id: turnId, p_steps: expected }
            );

            if (stepError || !data) return null;

            const row = data as { steps: number };
            return Number(row.steps);
          },
          emitText: (text) => send("delta", { text }),
          emitStep: (event) => send("step", event),
          propose,
          signal: abort.signal,
          startedAt,
        });

        // Any failure that produced no answer is refunded, including an
        // empty completion and a turn that could not advance.
        const refundReason = refundReasonFor({
          textLength: result.text.length,
          stopped: result.stopped,
        });

        if (refundReason) await refundTurn(refundReason);

        if (result.notice) send("notice", { message: result.notice });

        if (result.stopped === "paused") {
          // Still a draft: the signed continuation is what may add to it.
          if (changesetId) {
            send("changeset", {
              id: changesetId,
              status: "draft",
              files: changesetFiles,
            });
          }
        } else {
          await settleChangeset();
        }

        if (result.stopped === "paused") {
          if (result.text.length > 0) {
            try {
              await persist(
                `${result.text}\n\n_(paused at the time limit; the answer continues in the next message)_`
              );
            } catch (caught) {
              send("error", {
                message: `The answer could not be saved: ${messageOf(caught)}`,
                code: "persist",
              });
            }
          }

          if (sealKey) {
            send("paused", {
              turn: signEnvelope(
                {
                  turnId,
                  chatId,
                  model,
                  promptHash: hashPrompt(content || "continue"),
                  steps: result.steps,
                  exp: expiresAt,
                },
                sealKey
              ),
            });
          } else {
            send("error", {
              message:
                "This turn reached its time limit, and continuations are unavailable without GITHUB_TOKEN_KEY.",
              code: "paused",
            });
          }

          await finish("paused", result.text);
          return;
        }

        const text =
          result.stopped === "aborted" && result.text.length > 0
            ? `${result.text}\n\n_(stopped before this answer finished)_`
            : result.text;

        turnText = text;

        if (text.length > 0) {
          try {
            const saved = await persist(text);
            send("done", {
              id: saved?.id ?? null,
              seq: saved ? Number(saved.seq) : null,
              stopped: result.stopped,
              steps: result.steps,
              tokens: result.tokens,
            });
          } catch (caught) {
            send("error", {
              message: `The answer could not be saved: ${messageOf(caught)}`,
              code: "persist",
            });
          }
        } else if (result.stopped === "error" || result.stopped === "conflict") {
          send("error", {
            message: result.notice ?? "The turn failed.",
            code: result.stopped,
          });
        } else if (result.stopped === "aborted") {
          send("error", { message: "Stopped before the first token.", code: "aborted" });
        } else {
          send("error", {
            message: "The provider returned an empty answer.",
            code: "empty",
          });
        }
      } else {
        let produced = "";
        let failure: Error | null = null;

        const chain = providersFor(model);

        // A named model has exactly one provider. If its key is absent the loop
        // below would run zero times and the old path would report an empty
        // answer, which blames the model for a configuration gap.
        if (chain.length === 0) {
          failure = new Error(
            model === "auto"
              ? "No AI provider key is configured for this deployment."
              : "This model's provider key is not configured."
          );
        }

        for (const provider of chain) {
          try {
            for await (const delta of streamCompletion({
              provider,
              apiKeys: providerKeys(provider),
              messages: plainMessages,
              signal: abort.signal,
            })) {
              produced += delta;
              send("delta", { text: delta });
            }
            failure = null;
            break;
          } catch (caught) {
            failure = caught instanceof Error ? caught : new Error("The provider failed.");
            if (abort.signal.aborted) break;
          }
        }

        // An empty completion is a failed turn, so this is not limited to
        // thrown provider errors.
        const refundReason = refundReasonFor({
          textLength: produced.length,
          stopped: abort.signal.aborted ? "aborted" : failure ? "error" : "done",
        });

        if (refundReason) await refundTurn(refundReason);

        if (produced.length > 0) {
          const text = abort.signal.aborted
            ? `${produced}\n\n_(stopped before this answer finished)_`
            : produced;

          turnText = text;

          try {
            const saved = await persist(text);
            send("done", {
              id: saved?.id ?? null,
              seq: saved ? Number(saved.seq) : null,
              stopped: abort.signal.aborted ? "aborted" : "done",
              steps: 0,
              tokens: Math.ceil(text.length / 4),
            });
          } catch (caught) {
            send("error", {
              message: `The answer could not be saved: ${messageOf(caught)}`,
              code: "persist",
            });
          }
        } else if (failure) {
          send("error", {
            message: abort.signal.aborted ? "Stopped before the first token." : messageOf(failure),
            code: abort.signal.aborted ? "aborted" : "provider",
          });
        } else {
          send("error", { message: "The provider returned an empty answer.", code: "empty" });
        }
      }

      await finish(turnText.length > 0 ? "done" : "error", turnText);
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
