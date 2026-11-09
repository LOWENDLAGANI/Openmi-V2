import { after, NextResponse } from "next/server";

import {
  CONTINUE_AT_MS,
  MAX_STEPS,
  TURN_TTL_MS,
  hashPrompt,
  newTurnId,
  signEnvelope,
  verifyEnvelope,
} from "@/lib/agent/envelope";
import { runAgent } from "@/lib/agent/run";
import { createShellTurn } from "@/lib/agent/sandbox";
import { CHAT_SHELL_BUDGET_MS } from "@/lib/agent/shell";
import type { EditRequest } from "@/lib/changesets";
import { readAutoApproval } from "@/lib/changesets/autoapproval";
import {
  needsConfirmation,
  withStandingApproval,
} from "@/lib/changesets/confirmation";
import { autoWriteEnabled } from "@/lib/github/autowrite";
import { requestedBranch } from "@/lib/github/branch-request";
import { approveChangesetAndOpenPullRequest } from "@/lib/changesets/commit";
import {
  addEdits,
  createChangeset,
  finalizeChangeset,
  findDraftChangeset,
  loadConfirmationFacts,
} from "@/lib/changesets/store";
import { assembleContext } from "@/lib/context";
import { formatDew } from "@/lib/dew";
import { refundReasonFor } from "@/lib/dew/refund";
import {
  grantTrialDew,
  refundDewSession,
  startDewSession,
  type DewGate,
} from "@/lib/dew/store";
import { executionConfigured, sandboxTurnsEnabled, serverEnv } from "@/lib/env";
import { chatSandboxesEnabled } from "@/lib/execution/chat-env/lifecycle";
import {
  getFile,
  getRepo,
  getTree,
  isRepoFullName,
  MAX_PATH_INDEX,
  resolveBranchSha,
} from "@/lib/github/read";
import { readToken } from "@/lib/github/token";
import { hashIp, requestIp } from "@/lib/http/ip";
import { isSameOrigin } from "@/lib/http/origin";
import { appendMessage, listMessages, recentHistory } from "@/lib/messages";
import {
  AUTO_MODEL,
  firstAvailableModel,
  hasModel,
  type ModelId,
} from "@/lib/models";
import { buildSystemPrompt } from "@/lib/prompt";
import {
  autoChain,
  modelCatalogue,
  providerKeys,
  providersConfigured,
  providersFor,
  streamCompletion,
  type ChatMessage,
} from "@/lib/providers";
import { checkRateLimit } from "@/lib/rate-limit";
import { streamRouted } from "@/lib/routing/pipeline";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * A message that decides to use its sandbox needs the sandbox's own ceiling.
 * The same 300 s the mission and verification routes ask for: provisioning,
 * any command, and the model call around them inside one invocation.
 */
export const maxDuration = 300;

const MAX_MESSAGE_CHARS = 20_000;

type ChatRequest = {
  chatId?: unknown;
  content?: unknown;
  model?: unknown;
  path?: unknown;
  turn?: unknown;
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
  if (!isSameOrigin(request)) {
    return json({ error: "That request came from another origin." }, 403);
  }

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

  // Refused before anything is written: an empty message must not create a
  // chat row, and a deployment with no provider must not leave one behind.
  if (!continuationToken) {
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
      .insert({ owner: session.user.id, title: "New chat", charge_mode: "hour", ...pin })
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

  // An id the catalogue does not know — an old tab, a renamed custom entry, a
  // chat written before the catalogue shrank — opens the first model this
  // deployment can actually call, instead of failing the turn or opening on a
  // model whose key is missing.
  const modelOptions = modelCatalogue();
  const model: ModelId = hasModel(modelOptions, body.model)
    ? (body.model as string)
    : firstAvailableModel(modelOptions);


  // RLS decides whether this chat exists for this account; the select is the
  // request, not a second authority.
  const { data: chat, error } = await session.supabase
    .from("chats")
    .select("id, repo_full_name, repo_base_sha, repo_branch")
    .eq("id", chatId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!chat) return json({ error: "That chat does not exist." }, 404);

  const sealKey = serverEnv().githubTokenKey;

  let continuation: { turnId: string; steps: number; exp: number } | null = null;

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
      .select("turn_id, steps, expires_at")
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
  }

  // Trial Dew is granted here, not at signup: this is the first point in the
  // flow where the request has an address, and the grant is capped per address
  // per day. An account farm still gets accounts; it no longer gets paid for
  // them. A grant that fails is not a turn failure — the daily allowance still
  // applies, and nothing in the answer depends on it.
  const callerIp = continuationToken ? null : requestIp(request.headers);

  if (callerIp && sealKey) {
    const admin = supabaseAdmin();
    if (admin) {
      await grantTrialDew(admin, session.user.id, hashIp(callerIp, sealKey));
    }
  }

  // Charged only after the deployment can answer and after a continuation has
  // proved it belongs to this chat, so a bad token never costs anything. A
  // continuation inside the same running hour is reused by the database and
  // costs nothing, so it is safe to ask again here.
  const dew: DewGate = await startDewSession(
    session.supabase,
    model,
    typeof chat.repo_full_name === "string" ? chat.repo_full_name : null,
    { chatId }
  );

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
  const startedAt = Date.now();

  // The one composer: a message carries a sandbox if this deployment has one
  // and the chat is pinned to a repository. Nothing is created here — the
  // handle is lazy, so a message that never runs a command never pays for a
  // sandbox. The model chooses by calling a tool or not.
  // Notices are raised from inside the stream (a stopped workspace may have to
  // wake before the first command), so the callback is bound to the stream's
  // `send` once it exists rather than assuming one here.
  let sendNotice: (message: string) => void = () => {};

  // GitHub-only is the default: a turn reads the repository and proposes a diff
  // without provisioning a box. The sandbox is still whole — verification runs
  // and missions use their own — and one switch gives it back to chat turns.
  const shellTurn =
    sandboxTurnsEnabled() && executionConfigured() && repoFullName && sha && githubToken
      ? createShellTurn({
          token: githubToken,
          repo: repoFullName,
          sha,
          runId: turnId,
          deadline: startedAt + CHAT_SHELL_BUDGET_MS,
          chatId,
          owner: session.user.id,
          onNotice: (message) => sendNotice(message),
        })
      : null;
  const persistentShell = Boolean(shellTurn) && chatSandboxesEnabled();

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
    // With a handle in hand the answer is different, and so is the prompt.
    shell: Boolean(shellTurn),
    // A persistent workspace may be described as such; a per-message box may
    // not, because its files are gone when the answer ends.
    persistentShell,
    // A paused turn hands back an empty message. The clause is what makes the
    // model continue its own work — in the sandbox it still has — instead of
    // answering like a fresh chat.
    continuation: Boolean(continuation),
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

      sendNotice = (message: string) => send("notice", { message });

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
          label: `Started an hour of chat: ${formatDew(dew.session.price)} Dew charged. Balance ${formatDew(dew.session.balance)}.`,
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

        const admin = supabaseAdmin();
        const ok = admin
          ? await refundDewSession(
              admin,
              session.user.id,
              dew.session.sessionId,
              reason
            )
          : false;

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

          // A ready diff is written automatically unless it is one the reader
          // should decide on: the code moved, it is large, it touches
          // configuration, credentials or the schema, or nobody has reviewed
          // it. Those stay on the card, where the apply dialog asks first.
          if (finalized.status === "ready" && githubToken) {
            const { data: chatRow } = await session.supabase
              .from("chats")
              .select("repo_branch")
              .eq("id", chatId)
              .maybeSingle();

            const chatRowValue = chatRow as { repo_branch?: string | null } | null;
            const autoWrite = autoWriteEnabled();
            const branch = chatRowValue?.repo_branch ?? "main";

            if (sealKey && repoFullName) {
              // A ready diff is written without a click by default; a standing
              // approval is the fallback when an operator turns that off.
              const remembered = await readAutoApproval(session.supabase, {
                owner: session.user.id,
                repo: repoFullName,
                branch,
              });

              if (autoWrite || remembered) {
                const facts = changesetId
                  ? await loadConfirmationFacts(session.supabase, changesetId)
                  : null;

                let head: string | null = null;

                try {
                  head = await resolveBranchSha(githubToken, repoFullName, branch);
                } catch {
                  // A head that cannot be read is a reason to ask, not a reason
                  // to assume nothing moved since the suggestion.
                  head = null;
                }

                const mustAsk =
                  facts === null ||
                  needsConfirmation(withStandingApproval(facts, remembered), head);

                if (mustAsk) {
                  send("notice", {
                    message:
                      "This change needs your go-ahead. Use the card to apply it, look it over first, or discard it.",
                  });
                } else {
                  // "Push it to main" is a destination, not a preference. The
                  // reader naming a branch is the permission to write it, so the
                  // auto-write goes where they asked instead of demoting it to a
                  // pull request on an agent branch.
                  const askedBranch = requestedBranch(content, branch);

                  const approved = await approveChangesetAndOpenPullRequest(
                    session.supabase,
                    {
                      changesetId: changesetId as string,
                      owner: session.user.id,
                      sealKey,
                      target: askedBranch
                        ? { branch: askedBranch, explicit: true }
                        : undefined,
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
          }
        } catch (caught) {
          send("notice", {
            message: `The changeset could not be prepared: ${messageOf(caught)}`,
          });
        }
      };

      if (repoFullName && sha && githubToken) {
        // The sandbox is released before anything else runs, so a failure in
        // the answer path cannot leave a box billing behind the chat.
        const result = await (async () => {
          try {
            return await runAgent({
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
              emitReasoning: (text) => send("reasoning", { text }),
              emitStep: (event) => send("step", event),
              propose,
              shell: shellTurn,
              deadlineMs: shellTurn ? CHAT_SHELL_BUDGET_MS : CONTINUE_AT_MS,
              signal: abort.signal,
              startedAt,
            });
          } finally {
            await shellTurn?.close();
          }
        })();

        // Any failure that produced no answer is refunded, including an
        // empty completion and a turn that could not advance.
        const refundReason = refundReasonFor({
          textLength: result.text.length,
          stopped: result.stopped,
        });

        if (refundReason) await refundTurn(refundReason);

        // A paused turn continues when its workspace survives the invocation.
        // With a chat-scoped environment the continuation reattaches to the
        // same disk; with the per-message box it would reseed and re-run what
        // the reader already watched, so that path still ends here.
        const retainedWorkspace = shellTurn?.retainsWorkspace() ?? false;
        const pausable = result.stopped === "paused" && (!shellTurn || retainedWorkspace);

        if (result.notice) {
          send("notice", {
            message:
              result.stopped === "paused" && shellTurn && !retainedWorkspace
                ? "This message reached its time limit. The sandbox was released; send another message to carry on."
                : result.notice,
          });
        }

        if (pausable) {
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

        if (pausable) {
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
            : result.stopped === "paused" && shellTurn && !retainedWorkspace && result.text.length > 0
              ? `${result.text}\n\n_(this message reached its time limit in the sandbox)_`
              : (result.stopped === "error" || result.stopped === "conflict") &&
                  result.text.length > 0
                ? `${result.text}\n\n_(this answer stopped before it finished)_`
                : result.text;

        turnText = text;

        if (text.length > 0) {
          try {
            const saved = await persist(text);
            send("done", {
              id: saved?.id ?? null,
              seq: saved ? Number(saved.seq) : null,
              stopped:
                result.stopped === "error" || result.stopped === "conflict"
                  ? "partial"
                  : result.stopped,
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
        } else if (result.stopped === "paused") {
          send("error", {
            message: "The sandbox reached its time limit before there was an answer.",
            code: "paused",
          });
        } else {
          send("error", {
            message: "The provider returned an empty answer.",
            code: "empty",
          });
        }
      } else {
        let produced = "";
        let failure: Error | null = null;
        // Only Auto can settle incomplete: a named model has one endpoint, so
        // exhausting a queue is not a state it has.
        let complete = true;

        const auto = model === AUTO_MODEL;

        const prompt =
          content.length > 0
            ? content
            : [...history].reverse().find((message) => message.role === "user")?.content ?? "";

        const chain = auto ? autoChain(prompt) : providersFor(model);

        // A named model has exactly one provider. If its key is absent the loop
        // below would run zero times and the old path would report an empty
        // answer, which blames the model for a configuration gap.
        if (chain.length === 0) {
          failure = new Error(
            auto
              ? "No model is available to answer right now. Try again in a moment."
              : "That model isn't available right now. Pick another one."
          );
        } else if (auto) {
          // Auto is a queue, not an endpoint: the classifier picks the model
          // that fits, and a drop hands the partial answer to the next one. The
          // reader sees one answer either way, because a handover is not their
          // problem.
          const targets = chain.map((provider) => ({
            id: provider.model,
            stream: ({
              messages: next,
              signal,
            }: {
              messages: ChatMessage[];
              signal: AbortSignal;
            }) =>
              streamCompletion({
                provider,
                apiKeys: providerKeys(provider),
                messages: next,
                signal,
                onReasoning: (text) => send("reasoning", { text }),
              }),
          }));

          try {
            for await (const event of streamRouted({
              targets,
              messages: plainMessages,
              signal: abort.signal,
            })) {
              if (event.type === "delta") {
                produced += event.text;
                send("delta", { text: event.text });
              } else {
                complete = event.complete;
              }
            }
          } catch (caught) {
            failure = caught instanceof Error ? caught : new Error("The provider failed.");
          }
        } else {
          for (const provider of chain) {
            try {
              for await (const delta of streamCompletion({
                provider,
                apiKeys: providerKeys(provider),
                messages: plainMessages,
                signal: abort.signal,
                onReasoning: (text) => send("reasoning", { text }),
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
        }

        // An empty completion is a failed turn, so this is not limited to
        // thrown provider errors.
        const refundReason = refundReasonFor({
          textLength: produced.length,
          stopped: abort.signal.aborted
            ? "aborted"
            : failure || !complete
              ? "error"
              : "done",
        });

        if (refundReason) await refundTurn(refundReason);

        const incomplete = Boolean(failure) || !complete;

        if (produced.length > 0) {
          const text = abort.signal.aborted
            ? `${produced}\n\n_(stopped before this answer finished)_`
            : incomplete
              ? `${produced}\n\n_(this answer stopped before it finished)_`
              : produced;

          turnText = text;

          try {
            const saved = await persist(text);
            send("done", {
              id: saved?.id ?? null,
              seq: saved ? Number(saved.seq) : null,
              stopped: abort.signal.aborted ? "aborted" : incomplete ? "partial" : "done",
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
