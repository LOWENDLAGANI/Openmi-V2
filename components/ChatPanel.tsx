"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { MessageBody } from "@/components/MessageBody";
import type { ModelCapability, ModelId } from "@/lib/models";
import type { Message } from "@/lib/types";

type RepoRef = { fullName: string; branch: string; sha: string } | null;

type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  seq: number | null;
  model: string | null;
};

type StepLine = { detail: string; state: "start" | "done" | "error" };

type ContextMeter = {
  usedChars: number;
  budgetChars: number;
  notes: string[];
};

export function ChatPanel({
  chatId,
  repo,
  models,
  initialModel,
  initialMessages,
  validPaths,
  pinnedPath,
  providerReady,
}: {
  chatId: string;
  repo: RepoRef;
  models: ModelCapability[];
  initialModel: ModelId;
  initialMessages: Message[];
  validPaths: string[];
  pinnedPath: string | null;
  providerReady: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>(() =>
    initialMessages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      seq: Number(message.seq),
      model: message.model,
    }))
  );
  const [model, setModel] = useState<ModelId>(initialModel);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [steps, setSteps] = useState<StepLine[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meter, setMeter] = useState<ContextMeter | null>(null);
  const [lastSent, setLastSent] = useState("");

  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const continuedRef = useRef(false);

  async function send(content: string, turnToken?: string) {
    const continuation = typeof turnToken === "string";

    if (busyRef.current) return;
    if (!continuation && content.trim().length === 0) return;

    busyRef.current = true;
    setStreaming(true);
    setError(null);
    setPending("");
    setSteps([]);
    setNotices([]);

    let pausedToken: string | null = null;
    let assembled = "";
    let optimisticId: string | null = null;

    if (!continuation) {
      setLastSent(content);
      setDraft("");
      optimisticId = `local-${Date.now()}`;
      const localId = optimisticId;
      setMessages((current) => [
        ...current,
        { id: localId, role: "user", content, seq: null, model },
      ]);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          continuation
            ? { chatId, turn: turnToken }
            : { chatId, content, model, path: pinnedPath }
        ),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? `The request failed (${response.status}).`);
        if (optimisticId) {
          const failedId = optimisticId;
          setMessages((current) => current.filter((message) => message.id !== failedId));
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleBlock = (block: string) => {
        const lines = block.split("\n");
        const eventLine = lines.find((line) => line.startsWith("event:"));
        const dataLine = lines.find((line) => line.startsWith("data:"));
        if (!eventLine || !dataLine) return;

        const event = eventLine.slice(6).trim();
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
        } catch {
          return;
        }

        if (event === "user") {
          const id = typeof payload.id === "string" ? payload.id : optimisticId;
          const seq = typeof payload.seq === "number" ? payload.seq : null;
          if (!id) return;
          setMessages((current) =>
            current.map((message) =>
              message.id === optimisticId ? { ...message, id, seq } : message
            )
          );
          return;
        }

        if (event === "context") {
          setMeter({
            usedChars: Number(payload.usedChars ?? 0),
            budgetChars: Number(payload.budgetChars ?? 0),
            notes: Array.isArray(payload.notes) ? payload.notes.map(String) : [],
          });
          return;
        }

        if (event === "step") {
          const detail = typeof payload.detail === "string" ? payload.detail : "step";
          const state =
            payload.state === "done" || payload.state === "error" ? payload.state : "start";

          setSteps((current) => {
            const withoutPending = current.filter(
              (step) => !(step.detail === detail && step.state === "start")
            );
            if (state === "start") return [...current, { detail, state }];
            return [...withoutPending, { detail, state }];
          });
          return;
        }

        if (event === "notice") {
          const message = typeof payload.message === "string" ? payload.message : "";
          if (message) setNotices((current) => [...current, message]);
          return;
        }

        if (event === "delta") {
          assembled += typeof payload.text === "string" ? payload.text : "";
          setPending(assembled);
          return;
        }

        if (event === "paused") {
          pausedToken = typeof payload.turn === "string" ? payload.turn : null;
          return;
        }

        if (event === "done") {
          const id = typeof payload.id === "string" ? payload.id : `assistant-${Date.now()}`;
          const seq = typeof payload.seq === "number" ? payload.seq : null;
          setMessages((current) => [
            ...current,
            { id, role: "assistant", content: assembled, seq, model },
          ]);
          setPending("");
          router.refresh();
          return;
        }

        if (event === "error") {
          setError(typeof payload.message === "string" ? payload.message : "The turn failed.");
          setPending("");
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          handleBlock(block);
        }
      }
    } catch (caught) {
      const aborted = caught instanceof DOMException && caught.name === "AbortError";
      if (!aborted) {
        setError(caught instanceof Error ? caught.message : "The connection dropped.");
      }
      router.refresh();
    } finally {
      busyRef.current = false;
      setStreaming(false);
      abortRef.current = null;
      setPending("");
    }

    // A paused turn is continued once, with the signed token the server issued.
    // If that continuation also pauses, the reader is told instead of looping.
    if (pausedToken && !continuedRef.current) {
      continuedRef.current = true;
      await send("", pausedToken);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function retry() {
    if (lastSent.length > 0) void send(lastSent);
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <p className="text-[11px] text-low">
          {repo ? (
            <>
              Reading <span className="font-mono text-mid">{repo.fullName}</span> at{" "}
              <span className="font-mono text-mid">{repo.sha.slice(0, 7)}</span>
            </>
          ) : (
            "No repository attached, so answers cannot cite files."
          )}
        </p>

        <div className="flex items-center gap-2">
          {meter && (
            <span
              className="font-mono text-[10px] text-low"
              title="Characters of repository context sent with the last turn."
            >
              {Math.round(meter.usedChars / 1000)}k /{" "}
              {Math.round(meter.budgetChars / 1000)}k context
            </span>
          )}

          <select
            value={model}
            onChange={(event) => setModel(event.target.value as ModelId)}
            aria-label="Model"
            className="rounded-lg border border-line bg-card px-2 py-1 text-[11.5px] text-body"
          >
            {models.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {meter && meter.notes.length > 0 && (
        <ul className="mb-2 space-y-0.5 rounded-lg border border-line bg-raised px-3 py-2 text-[10.5px] leading-relaxed text-low">
          {meter.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {messages.length === 0 && pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
            <p className="text-[13px] font-medium text-hi">Nothing asked yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-mid">
              {repo
                ? "Ask about a file, a function or where something is defined. The agent reads the repository, and answers cite path:line."
                : "Attach a repository first, or ask a general question. Without a repository there is nothing to cite."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[90%] rounded-xl rounded-br-sm bg-chip px-3.5 py-2.5"
                    : "max-w-full rounded-xl px-1 py-1"
                }
              >
                <p className="pb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-low">
                  {message.role === "user" ? "You" : "Openmi"}
                  {message.seq === null ? " · saving" : ""}
                </p>
                <MessageBody
                  content={message.content}
                  repo={repo}
                  validPaths={validPaths}
                  chatId={chatId}
                />
              </article>
            ))}

            {(steps.length > 0 || pending.length > 0) && (
              <article className="max-w-full px-1 py-1">
                <p className="pb-1 font-mono text-[10px] uppercase tracking-[0.1em] text-low">
                  Openmi · working
                </p>

                {steps.length > 0 && (
                  <ul className="mb-2 space-y-0.5 rounded-lg border border-line bg-card px-3 py-2 font-mono text-[10.5px] text-low">
                    {steps.map((step, index) => (
                      <li key={`${step.detail}-${index}`}>
                        <span aria-hidden="true">
                          {step.state === "done" ? "✓" : step.state === "error" ? "✕" : "…"}
                        </span>{" "}
                        {step.detail}
                      </li>
                    ))}
                  </ul>
                )}

                {pending.length > 0 && (
                  <MessageBody
                    content={pending}
                    repo={repo}
                    validPaths={validPaths}
                    chatId={chatId}
                  />
                )}
              </article>
            )}
          </div>
        )}
      </div>

      {notices.length > 0 && (
        <ul className="mb-2 space-y-0.5 rounded-lg border border-line bg-raised px-3 py-2 text-[10.5px] leading-relaxed text-mid">
          {notices.map((notice, index) => (
            <li key={`${notice}-${index}`}>{notice}</li>
          ))}
        </ul>
      )}

      {error && (
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger"
        >
          <span>{error}</span>
          {lastSent.length > 0 && (
            <button
              type="button"
              onClick={retry}
              disabled={streaming}
              className="rounded border border-danger/40 px-2 py-0.5 text-[11px] hover:opacity-90 disabled:opacity-50"
            >
              Retry
            </button>
          )}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className="pt-1"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
          rows={3}
          placeholder={
            providerReady
              ? "Ask about this repository…"
              : "No provider key is configured — the setup page lists what is missing."
          }
          className="w-full resize-y rounded-xl border border-line bg-card px-3 py-2.5 text-[13px] leading-relaxed text-body placeholder:text-low"
        />

        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-[10.5px] text-low">
            Enter sends · Shift+Enter adds a line
            {meter ? "" : " · context is measured per turn"}
          </p>

          <div className="flex items-center gap-2">
            {streaming && (
              <button
                type="button"
                onClick={stop}
                className="rounded-lg border border-line bg-raised px-3 py-1.5 text-[12px] text-mid hover:text-hi"
              >
                Stop
              </button>
            )}
            <button
              type="submit"
              disabled={streaming || draft.trim().length === 0}
              className="rounded-lg bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-on-accent hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
