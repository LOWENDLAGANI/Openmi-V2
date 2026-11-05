"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { AdSlot } from "@/components/AdSlot";
import { AiThinking } from "@/components/AiThinking";
import { ChargeDialog } from "@/components/ChargeDialog";
import { DEW_EVENT } from "@/components/DewChip";
import { scrollToBottom, useEnter, useStagger } from "@/components/Motion";
import { DEW_PER_HOUR } from "@/lib/dew";
import { ContextCircle } from "@/components/ContextCircle";
import { MessageBody } from "@/components/MessageBody";
import { ModelMenu } from "@/components/ModelMenu";
import type { ModelCapability, ModelId } from "@/lib/models";
import type { Message } from "@/lib/types";

type RepoRef = { fullName: string; branch: string; sha: string } | null;

type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  seq: number | null;
  model: string | null;
  /** What the model did before it answered, kept with the answer it belongs to. */
  steps?: StepLine[];
};

/**
 * One thing the model did. A step is a sentence, not a log line: the command
 * and its output live behind the fold so the conversation still reads as a
 * conversation.
 */
type StepLine = {
  tool: string;
  detail: string;
  state: "start" | "done" | "error";
  command?: string;
  output?: string;
};

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
  dew,
}: {
  chatId: string | null;
  repo: RepoRef;
  models: ModelCapability[];
  initialModel: ModelId;
  initialMessages: Message[];
  validPaths: string[];
  pinnedPath: string | null;
  providerReady: boolean;
  initialRunning: boolean;
  /** The two balances a charge can draw on. */
  dew: { balance: number; wallet: number };
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
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meter, setMeter] = useState<ContextMeter | null>(null);
  const [lastSent, setLastSent] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [backgroundRunning, setBackgroundRunning] = useState(initialRunning);
  const [atBottom, setAtBottom] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | null>(chatId);
  // The first message of a new chat waits here until the hour is confirmed.
  const [chargeFor, setChargeFor] = useState<string | null>(null);
  const heroRef = useStagger<HTMLDivElement>(".motion-word, .motion-chip", {
    stagger: 0.05,
    delay: 0.05,
  });
  const [conflict, setConflict] = useState<{
    content: string;
    chatId: string | null;
  } | null>(null);

  const createdChatRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const continuedRef = useRef(false);
  const stopTimerRef = useRef<number | null>(null);

  /** A badge per model family, and the name shown on the card. */
  function modelLabel(id: string | null): string {
    if (!id) return "openmi";
    return models.find((entry) => entry.id === id)?.name ?? id;
  }

  function badgeFor(id: string | null): string {
    const category = models.find((entry) => entry.id === id)?.category;
    if (category === "coding") return "model-badge-code";
    if (category === "reasoning") return "model-badge-azure";
    return "model-badge-auto";
  }

  // While a turn is running without this tab driving it, ask the server whether
  // it is still going and re-read the transcript when it stops. This is the
  // half that makes closing the tab safe.
  useEffect(() => {
    if (!activeChatId || streaming || !backgroundRunning) return;

    let cancelled = false;

    const timer = window.setInterval(() => {
      void fetch(`/api/chat/turn?chatId=${encodeURIComponent(activeChatId)}`, {
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
  }, [backgroundRunning, streaming, activeChatId, router]);

  // Follow the transcript only while the reader is already at the end. A
  // tween per token is a stutter, so streaming jumps and a finished message is
  // the one arrival that eases. The reader can still scroll away: autoKill in
  // `scrollToBottom` stops the tween rather than fighting them.
  useEffect(() => {
    if (!atBottom) return;
    const element = scrollRef.current;
    if (!element) return;

    const tween = scrollToBottom(element, pending.length > 0);

    return () => {
      tween?.kill();
    };
  }, [messages, pending, steps, backgroundRunning, atBottom]);

  // A composer that grows with the question instead of showing a scrollbar
  // after two lines.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [draft]);

  // A pending stop timer must not outlive the component.
  useEffect(() => {
    return () => {
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    };
  }, []);

  // Every suggestion is a message, not a mode: two of these are answered from
  // the context and one of them makes the model open a shell.
  const suggestions = repo
    ? [
        {
          label: "Explain this repo",
          prompt: "Explain what this repository does and how it is structured.",
        },
        {
          label: "Make it build",
          prompt:
            "Install and build this repository, and fix whatever fails.",
        },
        {
          label: "Find a bug",
          prompt:
            "Look for a likely bug in this repository and point at the file and line.",
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

  /**
   * A new chat asks how to pay before anything is sent; an existing chat already
   * has an answer, stored on its row. Typing must never cost Dew silently.
   */
  function beginSend(content: string) {
    if (busyRef.current) return;
    if (content.trim().length === 0) return;

    // A new chat confirms the hour before it spends anything; an existing chat
    // is already paid for, so its messages go straight out.
    if (activeChatId === null) {
      setChargeFor(content);
      return;
    }

    void send(content);
  }

  async function endAndRetry(pendingChoose: { content: string }) {
    try {
      await fetch("/api/dew/end-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    } catch {
      // The retry is the test: a session that did not end answers 409 again.
    }

    setConflict(null);
    await send(pendingChoose.content);
  }

  async function send(content: string, turnToken?: string) {
    const continuation = typeof turnToken === "string";

    if (busyRef.current) return;
    if (!continuation && content.trim().length === 0) return;

    // One path for every message. Whether this answer needs a command, a file
    // read or nothing at all is the model's call, and the sandbox it would use
    // is provisioned inside that call, not before it.
    busyRef.current = true;
    setStreaming(true);
    setStopping(false);
    if (stopTimerRef.current) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    setError(null);
    setPending("");
    setSteps([]);
    setNotices([]);

    let pausedToken: string | null = null;
    let assembled = "";
    let sawDone = false;
    let optimisticId: string | null = null;

    // Steps belong to the answer they produced, so they are collected here and
    // stored on the message when it lands. A finished answer keeps its fold;
    // live progress is cleared the moment the turn ends.
    const stepLog: StepLine[] = [];

    const recordStep = (next: StepLine) => {
      if (next.state === "start") {
        stepLog.push(next);
      } else {
        let index = -1;
        for (let i = stepLog.length - 1; i >= 0; i -= 1) {
          if (stepLog[i].state === "start" && stepLog[i].detail === next.detail) {
            index = i;
            break;
          }
        }
        if (index >= 0) stepLog[index] = next;
        else stepLog.push(next);
      }
      setSteps([...stepLog]);
    };

    if (!continuation) {
      setLastSent(content);
      setDraft("");
      textareaRef.current?.focus();
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
            ? { chatId: activeChatId, turn: turnToken }
            : {
                chatId: activeChatId ?? undefined,
                content,
                model,
                path: pinnedPath,
                // A draft carries the repository it was started from, so the
                // row is created with the pin instead of losing it.
                repo: repo?.fullName,
                branch: repo?.branch,
                sha: repo?.sha,
              }
        ),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {        const payload = (await response.json().catch(() => null)) as
          | { error?: string; code?: string; activeChatId?: string | null }
          | null;

        setError(payload?.error ?? `The request failed (${response.status}).`);

        // A running hour is not a failure to retry blindly; the server names the
        // chat that holds it, and the reader decides between continuing there
        // and ending it.
        if (payload?.code === "hour-active") {
          setConflict({
            content,
            chatId: payload.activeChatId ?? null,
          });
        }

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

        if (event === "chat") {
          const id = typeof payload.id === "string" ? payload.id : null;
          if (!id) return;
          createdChatRef.current = id;
          setActiveChatId(id);
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

        if (event === "dew") {
          const label =
            typeof payload.label === "string"
              ? payload.label
              : "An hour of chat was charged.";

          // The charge is a fact, not a silent balance change. It is shown with
          // the turn's other notices, and the balance is handed to the header
          // chip now instead of waiting for the refresh round trip.
          setNotices((current) => [...current, label]);

          const balance = Number(payload.balance);
          const wallet = Number(payload.wallet);

          if (Number.isFinite(balance)) {
            window.dispatchEvent(
              new CustomEvent(DEW_EVENT, {
                detail: {
                  balance,
                  wallet: Number.isFinite(wallet) ? wallet : undefined,
                },
              })
            );
          }

          router.refresh();
          return;
        }

        if (event === "step") {
          const detail = typeof payload.detail === "string" ? payload.detail : "step";
          const state =
            payload.state === "done" || payload.state === "error" ? payload.state : "start";

          recordStep({
            tool: typeof payload.tool === "string" ? payload.tool : "step",
            detail,
            state,
            command: typeof payload.command === "string" ? payload.command : undefined,
            output: typeof payload.output === "string" ? payload.output : undefined,
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
          // The server appends the same note when it stores a stopped answer, so
          // the card on screen and the row in the transcript say the same thing.
          const content =
            payload.stopped === "aborted"
              ? `${assembled}\n\n_(stopped before this answer finished)_`
              : assembled;

          setMessages((current) => [
            ...current,
            { id, role: "assistant", content, seq, model, steps: [...stepLog] },
          ]);
          setPending("");
          sawDone = true;
          setSteps([]);
          if (stopTimerRef.current) {
            window.clearTimeout(stopTimerRef.current);
            stopTimerRef.current = null;
          }

          // The chat did not exist until this turn, so its URL is adopted once
          // the answer is safe to re-read. Doing it mid-stream would replace
          // the page underneath the stream.
          if (createdChatRef.current) {
            router.replace(`/chat?chat=${createdChatRef.current}`, {
              scroll: false,
            });
            createdChatRef.current = null;
          }

          router.refresh();
          return;
        }

        if (event === "error") {
          setError(typeof payload.message === "string" ? payload.message : "The turn failed.");
          setPending("");
          sawDone = true;
          setSteps([]);
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
      setStopping(false);
      abortRef.current = null;

      if (stopTimerRef.current) {
        window.clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }

      // A stopped turn is not a lost answer. If the stream ended without the
      // server's final "done", the part already on screen becomes a message
      // instead of vanishing with the composer state.
      if (!sawDone && assembled.trim().length > 0) {
        setMessages((current) => [
          ...current,
          {
            id: `local-stopped-${Date.now()}`,
            role: "assistant",
            content: `${assembled}\n\n_(stopped before this answer finished)_`,
            seq: null,
            model,
          },
        ]);
      }

      // Steps are live progress, not transcript. Leaving them set is what kept
      // the "thinking" pill on screen after a turn had already ended.
      setSteps([]);
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
    if (!streaming || stopping) return;

    setStopping(true);
    setBackgroundRunning(false);

    // Ask the server to stop first, and keep the stream open.
    //
    // Aborting this fetch only ends this view; the turn is deliberately not tied
    // to it. Aborting immediately is what used to discard the part of the
    // answer already on screen: the runner writes its final "done" after it
    // sees the stop flag, and that event never reached a closed stream. The
    // runner polls once every two seconds, so the wait is short.
    if (activeChatId) {
      void fetch("/api/chat/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: activeChatId }),
      })
        .then((response) => {
          if (!response.ok) abortRef.current?.abort();
        })
        .catch(() => {
          // No server to stop, so end this view rather than hang on it.
          abortRef.current?.abort();
        });
    } else {
      abortRef.current?.abort();
    }

    // Backstop: if no final event arrives, close the stream and keep the text.
    stopTimerRef.current = window.setTimeout(() => {
      stopTimerRef.current = null;
      abortRef.current?.abort();
    }, 8_000);
  }

  function retry() {
    if (lastSent.length > 0) void send(lastSent);
  }

  return (
    <div className="fade-in mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
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

        </div>

      </div>

      <div
        ref={scrollRef}
        aria-live="polite"
        onScroll={(event) => {
          const element = event.currentTarget;
          const distance =
            element.scrollHeight - element.scrollTop - element.clientHeight;
          setAtBottom(distance < 72);
        }}
        className="min-h-0 flex-1 overflow-y-auto py-2"
      >
        {messages.length === 0 && pending.length === 0 && steps.length === 0 ? (
          <div
            ref={heroRef}
            className="flex h-full flex-col items-center justify-center py-10 text-center"
          >
            <h2 className="text-[26px] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
              {(repo ? "What should Openmi do?" : "What are you building?")
                .split(" ")
                .map((word, index) => (
                  <span key={`${word}-${index}`} className="motion-word inline-block">
                    {word}
                    {index === 0 ? "\u00A0" : ""}
                  </span>
                ))}
            </h2>
            <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-low">
              {repo
                ? "Ask for an explanation or ask it to build, test or change something. It opens a Linux sandbox only when the answer needs one. Nothing is pushed without your approval."
                : "Pick a repository for answers that cite code."}
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {suggestions.slice(0, 2).map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => beginSend(suggestion.prompt)}
                  disabled={streaming}
                  className="motion-chip group flex items-center gap-2 rounded-full border border-line-strong bg-card px-4 py-2 text-[12px] text-mid transition-colors hover:border-accent/40 hover:text-hi"
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
                <EnteringArticle
                  key={message.id}
                  className="flex flex-col items-end gap-1"
                >
                  <div className="msg-user-bubble max-w-[88%] whitespace-pre-wrap">
                    {message.content}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDraft(message.content)}
                    className="thread-tool mr-1"
                  >
                    edit
                  </button>
                </EnteringArticle>
              ) : (
                <EnteringArticle key={message.id} className="group max-w-[94%]">
                  <div className="flex items-center justify-between gap-2 pb-1">
                    <span className={`model-badge ${badgeFor(message.model)}`}>
                      {modelLabel(message.model)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copy(message.id, message.content)}
                      className="thread-tool opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      {copiedId === message.id ? "copied" : "copy"}
                    </button>
                  </div>
                  <div className="msg-ai-card">
                    {message.steps && message.steps.length > 0 && (
                      <StepList steps={message.steps} />
                    )}
                    <MessageBody
                      content={message.content}
                      repo={repo}
                      validPaths={validPaths}
                      chatId={activeChatId ?? ""}
                    />
                  </div>
                </EnteringArticle>
              )
            )}

            {(steps.length > 0 || pending.length > 0 || backgroundRunning) && (
              <article className="max-w-[94%]" aria-live="polite">

                {steps.length > 0 && <StepList steps={steps} live />}

                {pending.length === 0 ? (
                  <AiThinking
                    steps={steps}
                    streaming={streaming}
                    backgroundRunning={backgroundRunning}
                  />
                ) : (
                  <MessageBody
                    content={pending}
                    repo={repo}
                    validPaths={validPaths}
                    chatId={activeChatId ?? ""}
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

      {conflict && (
        <div
          role="alert"
          className="mb-2 space-y-2 rounded-2xl border border-warn/30 bg-warn/8 px-4 py-2.5 text-[11.5px] text-warn"
        >
          <p className="leading-relaxed">
            An hour of chat is already running
            {conflict.chatId ? " in another chat" : ""}. Continue there, or end
            that session and start a new one here.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {conflict.chatId && (
              <a
                href={`/chat?chat=${conflict.chatId}`}
                className="rounded-full border border-warn/40 px-2.5 py-0.5 text-[11px] hover:opacity-90"
              >
                Open that chat
              </a>
            )}
            <button
              type="button"
              onClick={() => void endAndRetry(conflict)}
              disabled={streaming}
              className="rounded-full border border-warn/40 px-2.5 py-0.5 text-[11px] hover:opacity-90 disabled:opacity-50"
            >
              End session &amp; retry
            </button>
            <button
              type="button"
              onClick={() => setConflict(null)}
              className="text-[11px] underline-offset-2 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
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

      <div className="composer-dock -mx-4 mt-2 px-4 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-2 md:-mx-7 md:px-7">
        <div className="mx-auto w-full max-w-3xl">
          <div className="mb-1.5 flex justify-center">
            <AdSlot slot="mobile" className="w-full max-w-[320px] opacity-80" />
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              beginSend(draft);
            }}
          >
            <div className="rounded-[24px] border border-line-strong bg-card px-2 pb-2 pt-2 shadow-[0_18px_40px_-34px_rgba(0,0,0,0.7)] transition-colors focus-within:border-accent/45">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    beginSend(draft);
                  }
                }}
                rows={1}
                placeholder={
                  providerReady ? "Ask anything…" : "Chat is unavailable right now."
                }
                className="composer-input max-h-[168px] min-h-[44px] px-2 pt-0.5 text-[14px] leading-[1.6] focus:outline-none"
              />

              <div className="flex items-center justify-between gap-2 pl-1">
                <div className="flex min-w-0 items-center gap-2">
                  <ModelMenu
                    models={models}
                    value={model}
                    onChange={(id) => setModel(id as ModelId)}
                  />

                  {/* What the next message costs, so the price is never a
                      surprise after the answer. */}
                  <span
                    title={
                      activeChatId !== null
                        ? "Every message in this chat is covered for the hour."
                        : "The hour starts when the first message sends."
                    }
                    className="hidden items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-low sm:inline-flex"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-1 rounded-full ${
                        activeChatId !== null ? "bg-accent" : "bg-line-strong"
                      }`}
                    />
                    {activeChatId !== null
                      ? `hour · ${DEW_PER_HOUR} dew`
                      : "pay on send"}
                  </span>

                  {meter && (
                    <ContextCircle
                      usedChars={meter.usedChars}
                      budgetChars={meter.budgetChars}
                      notes={meter.notes}
                    />
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {streaming && (
                    <button
                      type="button"
                      onClick={stop}
                      disabled={stopping}
                      aria-label={stopping ? "Stopping the turn" : "Stop the turn"}
                      title={stopping ? "Stopping…" : "Stop"}
                      className="lift grid size-9 place-items-center rounded-full border border-line-strong text-hi hover:bg-hover disabled:opacity-60"
                    >
                      <span
                        aria-hidden="true"
                        className={`size-3 rounded-[3px] bg-current ${stopping ? "animate-blink" : ""}`}
                      />
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={streaming || draft.trim().length === 0}
                    aria-label="Send message"
                    className="lift grid size-9 place-items-center rounded-full bg-accent text-on-accent disabled:opacity-40"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 19V5M6 11l6-6 6 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </form>

          <p className="mt-1 text-center font-mono text-[9.5px] tracking-[0.05em] text-low">
            Content generated by Openmi AI. Might not be accurate.
          </p>
        </div>
      </div>

      <ChargeDialog
        open={chargeFor !== null}
        balance={dew.balance}
        wallet={dew.wallet}
        hourPrice={DEW_PER_HOUR}
        pending={streaming}
        onCancel={() => setChargeFor(null)}
        onConfirm={() => {
          const content = chargeFor;
          setChargeFor(null);
          if (content) void send(content);
        }}
      />
    </div>
  );
}

/**
 * What the model did, folded into the answer it produced.
 *
 * A row says what the step was for, in the model's own words: "install
 * dependencies", "Read lib/prompt.ts". The command and its output are one tap
 * away, because the reader who wants proof is not the reader who wants a
 * conversation. A live step shows its state; a stored one is already settled.
 */
function StepList({ steps, live = false }: { steps: StepLine[]; live?: boolean }) {
  return (
    <ol className="agent-steps" data-live={live ? "true" : "false"}>
      {steps.map((step, index) => (
        <li key={`${step.detail}-${index}`} className="agent-step" data-state={step.state}>
          <details>
            <summary>
              <span aria-hidden="true" className="agent-step-icon">
                {step.state === "start"
                  ? "…"
                  : step.state === "error"
                    ? "✕"
                    : step.command || step.output
                      ? "›_"
                      : "·"}
              </span>
              <span className="agent-step-title">{step.detail}</span>
              <span aria-hidden="true" className="agent-step-chevron">
                ›
              </span>
            </summary>
            {step.command && <pre className="agent-step-command">{step.command}</pre>}
            {step.output && step.output.trim().length > 0 && (
              <pre className="agent-step-output">{step.output}</pre>
            )}
          </details>
        </li>
      ))}
    </ol>
  );
}

/** One transcript entry, animated once when it joins the conversation. */
function EnteringArticle({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const ref = useEnter<HTMLElement>();

  return (
    <article ref={ref} className={className}>
      {children}
    </article>
  );
}
