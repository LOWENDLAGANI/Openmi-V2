import { NextResponse } from "next/server";

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
import {
  addEdits,
  createChangeset,
  finalizeChangeset,
  findDraftChangeset,
} from "@/lib/changesets/store";
import { assembleContext } from "@/lib/context";
import { refundDewSession, startDewSession } from "@/lib/dew/store";
import { serverEnv } from "@/lib/env";
import { getFile, getTree, isRepoFullName, MAX_PATH_INDEX } from "@/lib/github/read";
import { readToken } from "@/lib/github/token";
import { appendMessage, listMessages, recentHistory } from "@/lib/messages";
import { DEFAULT_MODEL, isModelId, type ModelId } from "@/lib/models";
import { buildSystemPrompt } from "@/lib/prompt";
import {
  providerKey,
  providersConfigured,
  providersFor,
  streamCompletion,
  type ChatMessage,
} from "@/lib/providers";
import { getSession } from "@/lib/session";

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
};

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
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

  const body = (await request.json().catch(() => null)) as ChatRequest | null;

  if (!body || typeof body.chatId !== "string") {
    return json({ error: "Malformed request." }, 400);
  }

  const chatId = body.chatId;
  const continuationToken = typeof body.turn === "string" ? body.turn : null;
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!continuationToken) {
    if (content.length === 0) return json({ error: "Write something first." }, 400);
    if (content.length > MAX_MESSAGE_CHARS) {
      return json(
        { error: `A message is capped at ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` },
        413
      );
    }
  }

  const model: ModelId = isModelId(body.model) ? body.model : DEFAULT_MODEL;

  // RLS decides whether this chat exists for this account; the select is the
  // request, not a second authority.
  const { data: chat, error } = await session.supabase
    .from("chats")
    .select("id, repo_full_name, repo_base_sha")
    .eq("id", chatId)
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!chat) return json({ error: "That chat does not exist." }, 404);

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

  // Charged only after the deployment can actually answer, so a missing
  // provider key never costs an hour. An hour that is still running is reused,
  // so a second turn inside it costs nothing more.
  const dew = await startDewSession(
    session.supabase,
    model,
    typeof chat.repo_full_name === "string" ? chat.repo_full_name : null
  );

  if (!dew.ok) {
    return json({ error: dew.error, code: "no-dew" }, 402);
  }

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

  const turnId = continuation?.turnId ?? newTurnId();
  const expiresAt = continuation ? continuation.exp : Date.now() + TURN_TTL_MS;

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

  const system = buildSystemPrompt({
    repo: repoFullName,
    sha,
    context: context.text,
    notes: context.notes,
    edits: Boolean(repoFullName && sha && sealKey),
  });

  const plainMessages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.map((message) => ({ role: message.role, content: message.content })),
  ];

  const userSeq = userMessage ? Number(userMessage.seq) : null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

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

      const abort = new AbortController();
      const onAbort = () => abort.abort();
      request.signal.addEventListener("abort", onAbort);

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

        if (!ok) {
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

        if (
          result.text.length === 0 &&
          (result.stopped === "error" || result.stopped === "aborted")
        ) {
          await refundTurn(
            result.stopped === "aborted"
              ? "Stopped before the first token"
              : "Provider failed before the first token"
          );
        }

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

          request.signal.removeEventListener("abort", onAbort);
          closed = true;
          controller.close();
          return;
        }

        const text =
          result.stopped === "aborted" && result.text.length > 0
            ? `${result.text}\n\n_(stopped before this answer finished)_`
            : result.text;

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

        for (const provider of providersFor(model)) {
          try {
            for await (const delta of streamCompletion({
              provider,
              apiKey: providerKey(provider),
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

        if (produced.length === 0 && (failure !== null || abort.signal.aborted)) {
          await refundTurn(
            abort.signal.aborted
              ? "Stopped before the first token"
              : "Provider failed before the first token"
          );
        }

        if (produced.length > 0) {
          const text = abort.signal.aborted
            ? `${produced}\n\n_(stopped before this answer finished)_`
            : produced;

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

      request.signal.removeEventListener("abort", onAbort);
      closed = true;
      controller.close();
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
