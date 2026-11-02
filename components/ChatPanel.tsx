"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  initialRunning,
}: {
  chatId: string;
  repo: RepoRef;
  models: ModelCapability[];
  initialModel: ModelId;
  initialMessages: Message[];
  validPaths: string[];
  pinnedPath: string | null;
  providerReady: boolean;
  initialRunning: boolean;
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [backgroundRunning, setBackgroundRunning] = useState(initialRunning);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const continuedRef = useRef(false);

  // While a turn is running without this tab driving it, ask the server whether
  // it is still going and re-read the transcript when it stops. This is the
  // half that makes closing the tab safe.
  useEffect(() => {
    if (streaming || !backgroundRunning) return;

    let cancelled = false;

    const timer = window.setInterval(() => {
      void fetch(`/api/chat/turn?chatId=${encodeURIComponent(chatId)}`, {
        cache: "no-store",
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { running?: boolean } | null) => {
          if (cancelled || !payload) return;
          if (payload.running) return;
          setBackgroundRunning(false);
          router.refresh();
        })
        .catch(() => {
          // A failed poll is not a failed turn; the next tick retries.
        });
    }, 2_500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [backgroundRunning, streaming, chatId, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, pending, steps, backgroundRunning]);

  const suggestions = repo
    ? [
        {
          label: "Explain this repo",
          prompt: "Explain what this repository does and how it is structured.",
        },
        {
          label: "Find a bug",
          prompt:
            "Look for a likely bug in this repository and point at the file and line.",
        },
        {
          label: "Review a file",
          prompt: "Review the most important file in this repository and its risks.",
        },
      ]
    : [
        {
          label: "What can you do?",
          prompt: "What can you do, and what do you refuse to do?",
        },
        {
          label: "Attach a repository",
          prompt: "How do I attach a GitHub repository to this chat?",
        },
      ];

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setCopiedId(null);
    }
  }

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

        // The review card is rendered on the server from the stored rows. The
        // event is only a cue to re-read them; no card state is invented here.
        if (event === "changeset") {
          router.refresh();
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
    // Tell the server first: aborting this fetch only ends the stream, and the
    // turn is deliberately not tied to it. The flag is what stops the work.
    void fetch("/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId }),
    }).catch(() => {
      // The abort below still ends this view.
    });

    abortRef.current?.abort();
  }

  function retry() {
    if (lastSent.length > 0) void send(lastSent);
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-line bg-card px-3 py-1">
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${
                repo ? "bg-accent" : "bg-line-strong"
              }`}
            />
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-mid">
              {repo ? repo.fullName : "no repository"}
            </span>
          </span>

          {repo ? (
            <span className="hidden font-mono text-[10px] text-low sm:inline">
              {repo.branch || "detached"} @ {repo.sha.slice(0, 7)}
            </span>
          ) : (
            <span className="hidden text-[11px] text-low sm:inline">
              answers cannot cite files
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {meter && (
            <span
              className="eyebrow"
              title="Characters of repository context sent with the last turn."
            >
              {Math.round(meter.usedChars / 1000)}k/
              {Math.round(meter.budgetChars / 1000)}k ctx
            </span>
          )}

          <select
            value={model}
            onChange={(event) => setModel(event.target.value as ModelId)}
            aria-label="Model"
            className="field w-auto py-1 text-[11.5px]"
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
        <ul className="mb-2 space-y-1 rounded-2xl border border-line bg-raised px-4 py-2">
          {meter.notes.map((note) => (
            <li key={note} className="text-[10.5px] leading-relaxed text-low">
              {note}
            </li>
          ))}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <div ref={bottomRef} />
        {messages.length === 0 && pending.length === 0 && steps.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-10 text-center">
            <span
              aria-hidden="true"
              className="grid size-11 place-items-center rounded-full bg-accent-soft text-[18px] text-accent-text"
            >
              ✳
            </span>
            <p className="eyebrow mt-5">empty conversation</p>
            <h2 className="mt-2 text-[27px] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
              Ask the repository anything.
            </h2>
            <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-mid">
              {repo
                ? "It reads the code at the pinned commit and answers with path:line. Edits arrive as a diff you review."
                : "Attach a repository first, or ask a general question. Without a repository there is nothing to cite."}
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => void send(suggestion.prompt)}
                  disabled={streaming}
                  className="group flex items-center gap-2 rounded-full border border-line-strong bg-card px-4 py-2 text-[12px] text-mid transition-colors hover:border-accent/40 hover:text-hi"
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-accent/60 group-hover:bg-accent"
                  />
                  {suggestion.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-7">
            {messages.map((message) =>
              message.role === "user" ? (
                <article key={message.id} className="flex flex-col items-end gap-1">
                  <div className="max-w-[88%] whitespace-pre-wrap rounded-[26px] rounded-br-lg bg-bubble px-4 py-2.5 text-[14px] leading-[1.6] text-bubble-text">
                    {message.content}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft(message.content)}
                    className="eyebrow mr-2 hover:text-hi"
                  >
                    edit
                  </button>
                </article>
              ) : (
                <article key={message.id} className="max-w-[94%]">
                  <div className="flex items-center justify-between gap-3 pb-1.5">
                    <p className="eyebrow text-accent-text">
                      {message.role === "system" ? "system" : "openmi"}
                      {message.seq === null ? " · saving" : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => void copy(message.id, message.content)}
                      className="eyebrow hover:text-hi"
                    >
                      {copiedId === message.id ? "copied" : "copy"}
                    </button>
                  </div>
                  <MessageBody
                    content={message.content}
                    repo={repo}
                    validPaths={validPaths}
                    chatId={chatId}
                  />
                </article>
              )
            )}

            {(steps.length > 0 || pending.length > 0 || backgroundRunning) && (
              <article className="max-w-[94%]">
                <p className="eyebrow pb-1.5 text-accent-text">openmi</p>

                {steps.length > 0 && (
                  <ul className="mb-2 space-y-1 rounded-2xl border border-line bg-raised px-4 py-2.5 font-mono text-[10.5px] leading-relaxed text-low">
                    {steps.map((step, index) => (
                      <li key={`${step.detail}-${index}`} className="truncate">
                        <span aria-hidden="true">
                          {step.state === "done" ? "✓" : step.state === "error" ? "✕" : "…"}
                        </span>{" "}
                        {step.detail}
                      </li>
                    ))}
                  </ul>
                )}

                {pending.length === 0 ? (
                  <div className="computing flex w-fit items-center gap-2.5 rounded-full bg-accent-soft px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-accent-text">
                    <span className="flex gap-1 text-[13px] leading-none" aria-hidden="true">
                      <span>•</span>
                      <span>•</span>
                      <span>•</span>
                    </span>
                    computing…
                  </div>
                ) : (
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
        <ul className="mb-2 space-y-1 rounded-2xl border border-line bg-raised px-4 py-2">
          {notices.map((notice, index) => (
            <li key={`${notice}-${index}`} className="text-[10.5px] leading-relaxed text-mid">
              {notice}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12px] text-danger"
        >
          <span className="min-w-0">{error}</span>
          {lastSent.length > 0 && (
            <button
              type="button"
              onClick={retry}
              disabled={streaming}
              className="rounded-full border border-danger/40 px-2.5 py-0.5 text-[11px] hover:opacity-90 disabled:opacity-50"
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
        className="pt-2"
      >
        {messages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => void send(suggestion.prompt)}
                disabled={streaming}
                className="rounded-full border border-line bg-card px-3 py-1 text-[11.5px] text-mid transition-colors hover:border-accent/40 hover:text-hi"
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-[28px] border border-line-strong/70 bg-card p-2 shadow-[0_18px_40px_-32px_rgba(22,18,12,0.6)] focus-within:border-accent/45">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            rows={2}
            placeholder={
              providerReady
                ? "Message Openmi…"
                : "No provider key is configured — the setup page lists what is missing."
            }
            className="w-full resize-none bg-transparent px-3 pt-1.5 text-[14px] leading-[1.6] text-body placeholder:text-low focus:outline-none"
          />

          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <p className="eyebrow hidden sm:block">
              enter sends · shift+enter adds a line
            </p>

            <div className="ml-auto flex items-center gap-2">
              {streaming && (
                <button
                  type="button"
                  onClick={stop}
                  className="btn btn-quiet px-3 py-1.5 text-[12px]"
                >
                  Stop
                </button>
              )}
              <button
                type="submit"
                disabled={streaming || draft.trim().length === 0}
                className="btn btn-primary px-4 py-2 text-[12.5px]"
              >
                Send
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </div>
        </div>

        <p className="mt-2.5 text-center font-mono text-[9.5px] uppercase tracking-[0.15em] text-low">
          {streaming || backgroundRunning
            ? "answering on the server · you can leave this page"
            : "answers cite path:line · nothing is pushed without approval"}
        </p>
      </form>
    </div>
  );
}
