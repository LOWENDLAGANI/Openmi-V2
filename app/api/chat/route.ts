import { NextResponse } from "next/server";

import { assembleContext } from "@/lib/context";
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

// Node runtime: the response is a plain ReadableStream, and the upstream calls
// need abort propagation that the edge runtime would only complicate.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_MESSAGE_CHARS = 20_000;

type ChatRequest = {
  chatId?: unknown;
  content?: unknown;
  model?: unknown;
  path?: unknown;
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

  if (session.state !== "signed-in") {
    return json({ error: "Sign in to chat." }, 401);
  }

  const body = (await request.json().catch(() => null)) as ChatRequest | null;

  if (!body || typeof body.chatId !== "string" || typeof body.content !== "string") {
    return json({ error: "Malformed request." }, 400);
  }

  const content = body.content.trim();
  if (content.length === 0) return json({ error: "Write something first." }, 400);
  if (content.length > MAX_MESSAGE_CHARS) {
    return json(
      { error: `A message is capped at ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` },
      413
    );
  }

  const model: ModelId = isModelId(body.model) ? body.model : DEFAULT_MODEL;

  // Captured as a const: the ReadableStream callback runs after this scope, by
  // which point TypeScript has dropped the property narrowing on `body`.
  const chatId = body.chatId;

  // RLS decides whether this chat exists for this account; the select is the
  // request, not a second authority.
  const { data: chat, error } = await session.supabase
    .from("chats")
    .select("id, repo_full_name, repo_branch, repo_base_sha")
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

  // Persisted before the provider call: a failed answer leaves the question in
  // the transcript instead of erasing what the user typed.
  let userMessage;
  try {
    userMessage = await appendMessage(session.supabase, chatId, "user", content, model);
  } catch (caught) {
    return json({ error: messageOf(caught) }, 500);
  }

  if (!userMessage) return json({ error: "The message was not saved." }, 500);

  const repoFullName =
    typeof chat.repo_full_name === "string" && isRepoFullName(chat.repo_full_name)
      ? chat.repo_full_name
      : null;
  const sha = typeof chat.repo_base_sha === "string" ? chat.repo_base_sha : null;

  let context = assembleContext({ paths: [], pinned: null });
  let repoFailed = false;

  if (repoFullName && sha) {
    try {
      const github = await readToken(session.supabase, session.user.id);

      if (!github) {
        repoFailed = true;
      } else {
        const tree = await getTree(github.token, repoFullName, sha);
        const paths = tree.entries
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
      context = assembleContext({ paths: [], pinned: null });
      context.notes.push(`The repository could not be read: ${messageOf(caught)}`);
    }
  }

  const history = recentHistory(await listMessages(session.supabase, body.chatId));

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt({
        repo: repoFullName,
        sha,
        context: context.text,
        notes: context.notes,
      }),
    },
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const chain = providersFor(model);
  const userSeq = Number(userMessage.seq);

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

      send("user", { id: userMessage.id, seq: userSeq });
      send("context", {
        usedChars: context.usedChars,
        budgetChars: context.budgetChars,
        notes: [
          ...context.notes,
          ...(repoFailed ? ["Repository reads failed for this turn."] : []),
        ],
      });

      let produced = "";
      let failure: Error | null = null;

      for (const provider of chain) {
        try {
          for await (const delta of streamCompletion({
            provider,
            apiKey: providerKey(provider),
            messages,
            signal: abort.signal,
          })) {
            produced += delta;
            send("delta", { text: delta });
          }
          failure = null;
          break;
        } catch (caught) {
          failure = caught instanceof Error ? caught : new Error("The provider failed.");
          // A mid-stream failure is not retried with another provider: the user
          // would get two half-answers spliced together. Stopping is honest.
          if (produced.length > 0 || abort.signal.aborted) break;
        }
      }

      const stopped = abort.signal.aborted;

      if (produced.length > 0) {
        const text = stopped
          ? `${produced}\n\n_(stopped before this answer finished)_`
          : produced;

        try {
          const saved = await appendMessage(
            session.supabase,
            chatId,
            "assistant",
            text,
            model,
            Math.ceil(text.length / 4)
          );

          send("done", {
            id: saved?.id ?? null,
            seq: saved ? Number(saved.seq) : null,
            stopped,
            usedChars: context.usedChars,
            budgetChars: context.budgetChars,
          });
        } catch (caught) {
          send("error", {
            message: `The answer could not be saved: ${messageOf(caught)}`,
            code: "persist",
          });
        }
      } else if (failure) {
        send("error", {
          message: stopped ? "Stopped before the first token." : messageOf(failure),
          code: stopped ? "aborted" : "provider",
        });
      } else {
        send("error", { message: "The provider returned an empty answer.", code: "empty" });
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
