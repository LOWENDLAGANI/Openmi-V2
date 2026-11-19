"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { AdSlot } from "@/components/AdSlot";
import { AiThinking } from "@/components/AiThinking";
import { ChargeDialog } from "@/components/ChargeDialog";
import {
  Composer,
  type ComposerCommand,
  type ContextMeter,
} from "@/components/Composer";
import { CREDIT_EVENT } from "@/components/CreditChip";
import { scrollToBottom, useEnter, useStagger } from "@/components/Motion";
import { RetryNotice } from "@/components/RetryNotice";
import { MessageBody } from "@/components/MessageBody";
import { PendingButton } from "@/components/PendingButton";
import { showComposerAd } from "@/lib/ads";
import {
  DEFAULT_REASONING_EFFORT,
  modelHourCredit,
  modelName,
  modelRequiresPaid,
  type ModelCapability,
  type ModelId,
  type ReasoningEffort,
} from "@/lib/models";
import type { AgentStep, Message } from "@/lib/types";

type RepoRef = { fullName: string; branch: string; sha: string } | null;

type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  seq: number | null;
  model: string | null;
  /** The chain of thought behind this answer, folded so reading it is optional. */
  thinking?: string;
  /** What the model did before it answered, kept with the answer it belongs to. */
  steps?: StepLine[];
  /** Screenshots the browser tool took while producing this answer. */
  shots?: Shot[];
};

/**
 * One thing the model did. A step is a sentence, not a log line: the command
 * and its output live behind the fold so the conversation still reads as a
 * conversation.
 */
type StepLine = AgentStep;

/**
 * What `GET /api/chat/turn` answers while a run this tab is not streaming is
 * still going: the run ids, and the work already written to its event log.
 */
type TurnPoll = {
  running?: boolean;
  error?: string | null;
  steps?: StepLine[];
  text?: string;
};

/** One screenshot, exactly as the sandbox returned it. */
type Shot = {
  mime: string;
  base64: string;
  caption: string;
};

/**
 * The note under an answer that stopped early. The worker writes it into the
 * stored row and the panel writes it under text that has not been stored yet, so
 * both spellings are recognised and the note is never doubled.
 */
const STOPPED_NOTE =
  /\n\n_\((?:stopped before this answer finished|this answer stopped before it finished)[^)]*\)_$/;

/** Adds the note unless the text already ends with one. */
function withStoppedNote(text: string, note: string): string {
  return STOPPED_NOTE.test(text) ? text : `${text}\n\n_(${note})_`;
}

/** A stored row in the shape the transcript renders. */
function toTranscript(rows: Message[]): UiMessage[] {
  return rows.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    seq: Number(message.seq),
    model: message.model,
    // The stored answer carries the work that produced it, so a reload keeps
    // the console instead of showing a bare paragraph.
    thinking: message.thinking ?? undefined,
    steps: Array.isArray(message.steps) ? message.steps : undefined,
  }));
}

/**
 * Folds a refreshed server transcript into what this tab is showing.
 *
 * `router.refresh()` re-renders the page but does not remount this panel, so its
 * first `initialMessages` used to be the last transcript it ever read: an answer
 * written while the tab was away arrived in the refresh payload and was thrown
 * away, which is why a finished turn looked like it had stopped until the page
 * was reloaded by hand.
 *
 * The stored rows are the authority. A local row is dropped once the server has
 * it — and a local copy of a stopped answer is dropped once a stored answer
 * begins with its text — while anything this tab still owns and the server has
 * not stored yet is kept after the stored list.
 */
function mergeTranscript(current: UiMessage[], stored: UiMessage[]): UiMessage[] {
  const storedIds = new Set(stored.map((message) => message.id));

  const kept = current.filter((message) => {
    if (storedIds.has(message.id)) return false;
    // Only this tab's own rows are candidates; anything else is stale.
    if (!message.id.startsWith("local-")) return false;

    if (message.role === "user") {
      // The optimistic copy of a message the server now has.
      return !stored.some(
        (row) => row.role === "user" && row.content === message.content
      );
    }

    // A stopped answer standing in for one the worker has now stored.
    const answer = message.content.replace(STOPPED_NOTE, "").trim();
    return !(
      answer.length > 0 &&
      stored.some(
        (row) => row.role === "assistant" && row.content.trim().startsWith(answer)
      )
    );
  });

  if (kept.length === 0) {
    const unchanged =
      stored.length === current.length &&
      stored.every(
        (message, index) =>
          message.id === current[index].id &&
          message.content === current[index].content &&
          message.model === current[index].model
      );

    // Nothing new arrived, so hand back the same array rather than a copy of it.
    if (unchanged) return current;
  }

  return kept.length === 0 ? stored : [...stored, ...kept];
}

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
  paidActive,
  credit,
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
  /** A live paid pass is what unlocks the paid-only models. */
  paidActive: boolean;
  /** The two balances a charge can draw on. */
  credit: { balance: number; wallet: number };
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>(() =>
    toTranscript(initialMessages)
  );
  const [model, setModel] = useState<ModelId>(initialModel);
  // The thinking effort the next message asks for. DeepSeek's own default, so a
  // reader who never touches the control gets what the model would have done.
  const [effort, setEffort] = useState<ReasoningEffort>(
    DEFAULT_REASONING_EFFORT
  );
  const [composer, setComposer] = useState<ComposerCommand>({ text: "", nonce: 0 });
  const [pending, setPending] = useState("");
  const [thinking, setThinking] = useState("");
  const [steps, setSteps] = useState<StepLine[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The sentence a paid-only model shows when the account has no live pass,
  // with the way to fix it. Nothing is sent while it is up.
  const [paidGate, setPaidGate] = useState<string | null>(null);
  const [meter, setMeter] = useState<ContextMeter | null>(null);
  const [lastSent, setLastSent] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  /** True when a streaming turn has gone quiet for longer than a reader waits. */
  const [stalled, setStalled] = useState(false);
  const [backgroundRunning, setBackgroundRunning] = useState(initialRunning);

  // A stored run can outlive the tab that started it. When the server says one
  // is live — on a reload, or on the refresh after a dropped stream — polling
  // has to resume, or the answer would arrive with nobody watching for it.
  useEffect(() => {
    if (initialRunning) setBackgroundRunning(true);
  }, [initialRunning]);

  // The transcript the server just rendered is the authority. This panel is not
  // remounted by `router.refresh()`, so without this the answer written while
  // the tab was away was read by the page and never reached the screen.
  useEffect(() => {
    const stored = toTranscript(initialMessages);
    setMessages((current) => mergeTranscript(current, stored));
  }, [initialMessages]);
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
    /** What the server said, so a model lock and a chat lock read apart. */
    message: string;
  } | null>(null);

  const createdChatRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // How many times this tab has reattached to a turn that outlived one request
  // window. A run is bounded at fifteen minutes and a window is four, so six is
  // headroom, not a loop.
  const continuedRef = useRef(0);
  const stopTimerRef = useRef<number | null>(null);
  // Whether the reader asked for this turn to stop, so a closed stream is not
  // mistaken for a turn that is still running elsewhere.
  const stoppedRef = useRef(false);

  /**
   * Hands text to the composer: an edited message, or an empty field after a
   * send. The draft lives in <Composer>, so typing re-renders one textarea
   * instead of this transcript; the parent bumps a token and the composer
   * adopts whatever came with it.
   */
  function seedComposer(next: string) {
    setComposer((current) => ({ text: next, nonce: current.nonce + 1 }));
  }

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

    // The run lives in the worker, not in this tab, so the poll asks for the
    // work it has already done and shows that instead of one sentence that
    // says nothing. A reload therefore lands on the steps the run has taken
    // and the answer as far as it has been written.
    const tick = () =>
      fetch(`/api/chat/turn?chatId=${encodeURIComponent(activeChatId)}`, {
        cache: "no-store",
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: TurnPoll | null) => {
          if (cancelled || !payload) return;

          if (payload.running) {
            if (Array.isArray(payload.steps) && payload.steps.length > 0) {
              setSteps(payload.steps);
            }
            if (typeof payload.text === "string" && payload.text.length > 0) {
              setPending(payload.text);
            }
            return;
          }

          setBackgroundRunning(false);
          // Settled: the refreshed transcript carries the steps and the answer
          // both, so the live copy goes rather than sitting under the answer —
          // including the reasoning, which would otherwise leave a lone folded
          // block behind for a turn that is over.
          setSteps([]);
          setPending("");
          setThinking("");
          // The poll is also where a run nothing finished is settled, so it is
          // where the reason arrives. Without it the wait ended in silence.
          if (typeof payload.error === "string" && payload.error.length > 0) {
            setError(payload.error);
          }
          router.refresh();
        })
        .catch(() => {
          // A failed poll is not a failed turn; the next tick retries.
        });

    // Once now, so the first frame after a reload already has the work on
    // screen rather than waiting 2.5s for it.
    void tick();
    const timer = window.setInterval(() => void tick(), 2_500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [backgroundRunning, streaming, activeChatId, router]);

  // A silent stream is the state a reader cannot tell from a dead connection.
  // Twelve seconds without a token, a step or a line of thinking is long enough
  // to be worth saying out loud; any new output clears it again.
  useEffect(() => {
    if (!streaming) {
      setStalled(false);
      return;
    }

    setStalled(false);
    const timer = window.setTimeout(() => setStalled(true), 12_000);

    return () => window.clearTimeout(timer);
  }, [streaming, pending.length, steps.length, thinking.length]);

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

  /**
   * Back to the live end of the transcript.
   *
   * The panel only follows the end while the reader is already at it, which is
   * right — reading one line of a streaming answer should not be a tug of war.
   * The cost is that scrolling up once leaves the answer running off-screen, so
   * the pill above the transcript is the way back.
   */
  function jumpToLatest() {
    const element = scrollRef.current;
    if (element) scrollToBottom(element, true);
    setAtBottom(true);
  }

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
   * has an answer, stored on its row. Typing must never cost Credit silently.
   */
  function beginSend(content: string) {
    if (busyRef.current) return;
    if (content.trim().length === 0) return;

    // A paid-only model is refused here with the sentence that says what to do,
    // before a dialog opens or a request leaves. The server refuses it again,
    // and the database refuses the hour itself.
    if (modelRequiresPaid(model, models) && !paidActive) {
      setPaidGate(
        `${modelName(model, models)} is part of the paid plan. Start a pass on Plans, then pick it again.`
      );
      return;
    }

    // A new chat confirms the hour before it spends anything; an existing chat
    // is already paid for, so its messages go straight out. A free hour has
    // nothing to confirm, so it goes straight out too — and still starts the
    // session server-side, because the hour scopes the chat, not the charge.
    if (activeChatId === null && modelHourCredit(model, models) > 0) {
      setChargeFor(content);
      return;
    }

    void send(content);
  }

  async function endAndRetry(pendingChoose: { content: string }) {
    try {
      await fetch("/api/credits/end-session", {
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

  /**
   * Sends a message, or continues the window of a turn already running.
   *
   * A continuation is the same answer seen through the next stream, so what the
   * reader already has travels with it: `resume` is the text, the reasoning, the
   * steps, the screenshots and the cursor this window reached. Starting from
   * nothing is what made a long answer blank at the boundary and keep only the
   * tail that arrived afterwards.
   */
  async function send(
    content: string,
    turnToken?: string,
    resume?: {
      text: string;
      thinking: string;
      steps: StepLine[];
      shots: Shot[];
      /** Null when the server did not name one; the route then uses its own. */
      cursor: number | null;
    }
  ) {
    const continuation = typeof turnToken === "string";

    if (busyRef.current) return;
    if (!continuation && content.trim().length === 0) return;

    // A new message starts its own continuation budget. Nothing else reset this
    // counter, so after six windows in one visit every later long turn stopped
    // being followed at its first handover.
    if (!continuation) continuedRef.current = 0;

    // One path for every message. Whether this answer needs a command, a file
    // read or nothing at all is the model's call, and the sandbox it would use
    // is provisioned inside that call, not before it.
    busyRef.current = true;
    stoppedRef.current = false;
    setStreaming(true);
    setStopping(false);
    if (stopTimerRef.current) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    setError(null);
    setPending(resume?.text ?? "");
    setThinking(resume?.thinking ?? "");
    setSteps(resume?.steps ? [...resume.steps] : []);
    setShots(resume?.shots ? [...resume.shots] : []);
    // A continuation is the same turn, so the charge and queue notices that
    // belong to it stay on screen instead of being wiped at the boundary.
    if (!resume) setNotices([]);

    let pausedToken: string | null = null;
    /**
     * Where this window stopped in the run's event log, for the next one. Null
     * when the server did not say: replaying from zero would append the whole
     * answer a second time on top of the text already carried over.
     */
    let pausedCursor: number | null = null;
    let assembled = resume?.text ?? "";
    let thinkingText = resume?.thinking ?? "";
    let sawDone = false;
    /** True once the server reported a failure for this window. */
    let failed = false;
    /** True when this window ends on a token rather than a finished turn. */
    let resuming = false;
    // The server accepted a run for this turn, so a stream that ends without
    // "done" is a turn still out there rather than a request that was refused.
    let attached = false;
    // True once a transcript message owns this turn's steps, so the live console
    // below can be cleared without losing them.
    let stepsCarried = false;
    let optimisticId: string | null = null;

    // Steps belong to the answer they produced, so they are collected here and
    // stored on the message when it lands. A finished answer keeps its fold;
    // live progress is cleared the moment the turn ends.
    const stepLog: StepLine[] = resume?.steps ? [...resume.steps] : [];
    const shotLog: Shot[] = resume?.shots ? [...resume.shots] : [];

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
      seedComposer("");
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
            ? { chatId: activeChatId, turn: turnToken, cursor: resume?.cursor ?? null }
            : {
                chatId: activeChatId ?? undefined,
                content,
                model,
                effort,
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
            message: payload?.error ?? "An hour of chat is already running.",
          });
        }

        if (optimisticId) {
          const failedId = optimisticId;
          setMessages((current) => current.filter((message) => message.id !== failedId));
        }
        return;
      }

      attached = true;

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

        if (event === "credit") {
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
              new CustomEvent(CREDIT_EVENT, {
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

          // A screenshot rides on the step that produced it. It is shown now and
          // attached to the answer when the turn settles, so scrolling back
          // through this session still shows what the model actually saw.
          const image = payload.image as
            | { mime?: unknown; base64?: unknown; caption?: unknown }
            | undefined;

          if (
            image &&
            typeof image.mime === "string" &&
            typeof image.base64 === "string"
          ) {
            shotLog.push({
              mime: image.mime,
              base64: image.base64,
              caption:
                typeof image.caption === "string" && image.caption.length > 0
                  ? image.caption
                  : "Screenshot",
            });
            setShots([...shotLog]);
          }

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

        // The chain of thought arrives before the answer it precedes. It is kept
        // apart from `pending` so it can fold away: seeing that the model
        // thought is useful, reading it is a choice.
        if (event === "reasoning") {
          thinkingText += typeof payload.text === "string" ? payload.text : "";
          setThinking(thinkingText);
          return;
        }

        if (event === "paused") {
          pausedToken = typeof payload.turn === "string" ? payload.turn : null;
          pausedCursor =
            typeof payload.cursor === "number" ? payload.cursor : null;
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
          // The answer and its reasoning are read back from the database row the
          // worker wrote, so a dropped stream or a missed delta cannot leave a
          // different sentence on screen than the one stored. The one exception
          // is a row shorter than the stream: that row was cut at the storage
          // cap, and the longer copy is what the model actually wrote.
          const rowContent =
            typeof payload.content === "string" ? payload.content : "";
          // The row is the answer as stored, the stream is the same answer as it
          // arrived. A row shorter than what reached this tab was cut at the
          // storage cap, so the longer copy is the one the model actually wrote.
          const storedContent =
            rowContent.length >= assembled.length ? rowContent : assembled;
          const storedThinking =
            typeof payload.thinking === "string" && payload.thinking.length > 0
              ? payload.thinking
              : thinkingText;
          const storedSteps = Array.isArray(payload.steps)
            ? (payload.steps as StepLine[])
            : [...stepLog];
          // The worker stores the same note with a stopped answer, so the card
          // and the row say the same thing and neither writes it twice.
          const content =
            payload.stopped === "aborted"
              ? withStoppedNote(storedContent, "stopped before this answer finished")
              : payload.stopped === "partial"
                ? withStoppedNote(
                    storedContent,
                    "this answer stopped before it finished"
                  )
                : storedContent;

          // A run that settled without writing a sentence has nothing to put in
          // a card, and an empty card reads as a broken answer. Say what
          // happened instead, and keep the console that shows how it got there.
          if (storedContent.trim().length === 0) {
            setError(
              (current) => current ?? "The run finished without an answer."
            );
            setPending("");
            sawDone = true;
            router.refresh();
            return;
          }

          setMessages((current) => [
            ...current,
            {
              id,
              role: "assistant",
              content,
              seq,
              model,
              thinking: storedThinking,
              steps: storedSteps,
              shots: [...shotLog],
            },
          ]);
          setPending("");
          sawDone = true;
          // The finished message carries the steps now.
          stepsCarried = true;
          setShots([]);
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
          // The part of the answer already on screen stays. The worker stored
          // that same text, so blanking it here is what made a failed turn look
          // like a turn that never answered, until the page was reloaded.
          failed = true;
          sawDone = true;
          // The steps stay: a failed turn has no message to carry them, and
          // the command output is the only evidence of what went wrong.
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

      // A window that ended with a token is not a stopped turn: the next one
      // takes the answer on from exactly here, so its text stays live instead of
      // being committed with a "stopped" note around it.
      resuming = pausedToken !== null && continuedRef.current < 6;

      // A stopped turn is not a lost answer. If the stream ended without the
      // server's final "done", the part already on screen becomes a message
      // instead of vanishing with the composer state.
      if (!sawDone && !resuming && assembled.trim().length > 0) {
        stepsCarried = true;
        setMessages((current) => [
          ...current,
          {
            id: `local-stopped-${Date.now()}`,
            role: "assistant",
            content: withStoppedNote(
              assembled,
              "stopped before this answer finished"
            ),
            seq: null,
            model,
            thinking: thinkingText,
            steps: [...stepLog],
          },
        ]);
      }

      // A finished or stopped answer carries its console on the message card, so
      // the live copy can go. A turn that failed, or stopped before any text,
      // keeps the console on screen: that output is the only record of what the
      // sandbox did, and clearing it is what made a failed run impossible to
      // diagnose.
      setSteps(resuming || !stepsCarried ? [...stepLog] : []);
      // Text that arrived before a failure or a handover is the answer so far,
      // and it is already stored; it stays on screen rather than vanishing.
      // A committed message already carries the answer, so the live copy only
      // stays when nothing was written into the transcript.
      const keepLive = resuming || (failed && !stepsCarried);
      setPending(keepLive ? assembled : "");
      setThinking(keepLive ? thinkingText : "");

      // The stream can end without the turn ending: a dropped connection, or the
      // continuation budget running out. A turn the server accepted is still in
      // the queue or the worker, so hand it to the poll — that is the half which
      // either reports the answer or ends the wait with its reason. A refused
      // request and a stop the reader asked for have nothing to follow.
      // A continuation names a run that exists even when this window's request
      // was refused or dropped, so it is handed to the poll too.
      if ((attached || continuation) && !sawDone && !stoppedRef.current && !resuming) {
        setBackgroundRunning(true);
      }
    }

    // A paused turn is continued once, with the token the server issued and the
    // cursor this window reached. If that continuation also pauses, the reader
    // is told instead of looping.
    if (resuming && pausedToken) {
      continuedRef.current += 1;
      await send("", pausedToken, {
        text: assembled,
        thinking: thinkingText,
        steps: stepLog,
        shots: shotLog,
        cursor: pausedCursor,
      });
    }

    // A chat created by this turn is adopted even when the stream ended without
    // a "done" — a stop, a dropped connection, a refused continuation. Otherwise
    // the tab stays on the draft URL and the conversation, with the answer the
    // worker is still writing, has no address to come back to.
    if (!resuming && createdChatRef.current) {
      const id = createdChatRef.current;
      createdChatRef.current = null;
      router.replace(`/chat?chat=${id}`, { scroll: false });
      router.refresh();
    }
  }

  function stop() {
    if (!streaming || stopping) return;

    stoppedRef.current = true;
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
    // Return the promise so the button holds its pending state until the turn
    // it started actually settles.
    if (lastSent.length > 0) return send(lastSent);
  }

  return (
    <div className="fade-in mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${
                repo ? "bg-accent" : "bg-line-strong"
              }`}
            />
            <span className="truncate text-[11.5px] text-mid">
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
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain py-2"
      >
        {messages.length === 0 && pending.length === 0 && steps.length === 0 ? (
          <div
            ref={heroRef}
            className="flex h-full flex-col items-center justify-center py-10 text-center"
          >
            <h2 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-hi" style={{ fontFamily: "var(--font-display)" }}>
              {(repo ? "What should Openmi do?" : "What are you building?")
                .split(" ")
                .map((word, index, words) => (
                  <span key={`${word}-${index}`} className="motion-word inline-block">
                    {word}
                    {/* Every word but the last carries its space inside the
                        span: an inline-block word swallows the whitespace
                        between elements, so "Openmi do?" was rendering as
                        "Openmido?". */}
                    {index === words.length - 1 ? "" : "\u00A0"}
                  </span>
                ))}
            </h2>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {suggestions.slice(0, 3).map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => beginSend(suggestion.prompt)}
                  disabled={streaming}
                  className="motion-chip group flex items-center gap-2 rounded-xl border border-line bg-card px-3.5 py-2 text-[12px] text-mid shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-line-strong hover:bg-hover hover:text-hi"
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
                  className="flex min-w-0 flex-col items-end gap-1"
                >
                  <div className="msg-user-bubble max-w-[88%] min-w-0 whitespace-pre-wrap break-words">
                    {message.content}
                  </div>
                  <button
                    type="button"
                    onClick={() => seedComposer(message.content)}
                    className="thread-tool mr-1"
                  >
                    edit
                  </button>
                </EnteringArticle>
              ) : (
                <EnteringArticle key={message.id} className="group min-w-0 max-w-[94%]">
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
                    {message.thinking && <ThinkingBlock text={message.thinking} />}
                    {message.steps && message.steps.length > 0 && (
                      <StepList steps={message.steps} />
                    )}
                    {message.shots && message.shots.length > 0 && (
                      <ShotStrip shots={message.shots} />
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

            {(steps.length > 0 ||
              pending.length > 0 ||
              thinking.length > 0 ||
              shots.length > 0 ||
              backgroundRunning) && (
              <article
                className="min-w-0 max-w-[94%]"
                aria-live="polite"
                aria-busy={streaming}
              >

                {thinking.length > 0 && <ThinkingBlock text={thinking} live />}

                {/* `live` follows the turn, not the panel: a console kept after
                    a failure must not still claim to be running. */}
                {steps.length > 0 && <StepList steps={steps} live={streaming} />}

                {shots.length > 0 && <ShotStrip shots={shots} />}

                {pending.length === 0 ? (
                  // Only while a turn is in flight. A console kept from a failed
                  // turn must not put a "thinking" pill back on screen.
                  (streaming || backgroundRunning) && (
                    <AiThinking
                      steps={steps}
                      streaming={streaming}
                      backgroundRunning={backgroundRunning}
                    />
                  )
                ) : (
                  <MessageBody
                    content={pending}
                    repo={repo}
                    validPaths={validPaths}
                    chatId={activeChatId ?? ""}
                  />
                )}
                {streaming && stalled && pending.length === 0 && (
                  <p className="mt-1 text-[11px] leading-relaxed text-low">
                    Still working. No answer text yet — the steps above are what
                    the turn has done.
                  </p>
                )}
                {streaming && pending.length > 0 && (
                  <span aria-hidden="true" className="stream-caret" />
                )}
              </article>
            )}
          </div>
        )}

        {!atBottom && (
          <div className="pointer-events-none sticky bottom-0 z-10 flex justify-center pb-1">
            <button
              type="button"
              onClick={jumpToLatest}
              className="pointer-events-auto rounded-full border border-line bg-card px-3 py-1.5 text-[11px] text-mid shadow-[0_10px_28px_rgba(0,0,0,0.14)] transition-colors hover:border-line-strong hover:text-hi"
            >
              {streaming ? "new output ↓" : "jump to end ↓"}
            </button>
          </div>
        )}
      </div>

      {notices.length > 0 && (
        <ul className="mb-2 space-y-1 rounded-2xl border border-line bg-card px-4 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          {notices.map((notice, index) => (
            <li
              key={`${notice}-${index}`}
              className="break-words text-[10.5px] leading-relaxed text-mid"
            >
              {notice}
            </li>
          ))}
        </ul>
      )}

      {conflict && (
        <div
          role="alert"
          className="mb-2 space-y-2 rounded-2xl border border-warn/30 bg-warn/8 px-4 py-3 text-[11.5px] text-warn"
        >
          <p className="break-words leading-relaxed">{conflict.message}</p>
          <div className="flex flex-wrap items-center gap-2">
            {conflict.chatId && (
              <a
                href={`/chat?chat=${conflict.chatId}`}
                className="rounded-full border border-warn/40 px-2.5 py-0.5 text-[11px] hover:opacity-90"
              >
                Open that chat
              </a>
            )}
            <PendingButton
              onAction={() => endAndRetry(conflict)}
              disabled={streaming}
              pendingText="Ending…"
              className="rounded-full border border-warn/40 px-2.5 py-0.5 text-[11px] hover:opacity-90"
            >
              End session &amp; retry
            </PendingButton>
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

      {paidGate && (
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-[12px] text-hi"
        >
          <span className="min-w-0 break-words">{paidGate}</span>
          <div className="flex items-center gap-2">
            <a
              href="/pay"
              className="rounded-full border border-accent/40 px-2.5 py-0.5 text-[11px] text-accent-text hover:opacity-90"
            >
              See plans
            </a>
            <button
              type="button"
              onClick={() => setPaidGate(null)}
              className="text-[11px] text-mid underline-offset-2 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-danger/25 bg-danger/8 px-4 py-3 text-[12px] text-danger"
        >
          <span className="min-w-0 break-words">
            <RetryNotice message={error} />
          </span>
          {lastSent.length > 0 && (
            <PendingButton
              onAction={retry}
              disabled={streaming}
              pendingText="Retrying…"
              className="rounded-full border border-danger/40 px-2.5 py-0.5 text-[11px] hover:opacity-90"
            >
              Retry
            </PendingButton>
          )}
        </div>
      )}

      <div className="composer-dock -mx-4 mt-3 px-4 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-3 md:-mx-8 md:px-8">
        <div className="mx-auto w-full max-w-3xl">
          {showComposerAd(activeChatId) && (
            <div className="mb-1.5 flex justify-center">
              <AdSlot
                slot="mobile"
                className="w-full max-w-[320px] opacity-80"
              />
            </div>
          )}

          <Composer
            models={models}
            model={model}
            onModelChange={(id) => {
              setModel(id as ModelId);
              setPaidGate(null);
            }}
            effort={effort}
            onEffortChange={setEffort}
            paidActive={paidActive}
            meter={meter}
            activeChatId={activeChatId}
            repo={repo ? repo.fullName : null}
            streaming={streaming}
            stopping={stopping}
            providerReady={providerReady}
            command={composer}
            onSend={beginSend}
            onStop={stop}
          />
        </div>
      </div>

      <ChargeDialog
        open={chargeFor !== null}
        balance={credit.balance}
        wallet={credit.wallet}
        hourPrice={modelHourCredit(model, models)}
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
 * dependencies", "Read lib/runs/tools.ts". The command and its output are one tap
 * away, because the reader who wants proof is not the reader who wants a
 * conversation. A live step shows its state; a stored one is already settled.
 */
/**
 * The chain of thought, folded.
 *
 * A thinking model streams what it is weighing before it answers, on a channel
 * of its own. Printing it would put the working out into the conversation, so it
 * folds; dropping it would pretend the model does not think. A live block starts
 * open — the point of reading in real time is to see it think — and a stored one
 * opens on a tap. Neither renders as part of the answer.
 */
function ThinkingBlock({ text, live = false }: { text: string; live?: boolean }) {
  return (
    <details
      open={live ? true : undefined}
      className="mb-2 rounded-2xl border border-line bg-raised/60 px-3 py-1.5"
      data-live={live ? "true" : "false"}
    >
      <summary className="cursor-pointer text-[11px] text-low">
        {live ? "thinking…" : "reasoning"}
      </summary>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-mid [overflow-wrap:anywhere]">
        {text}
      </p>
    </details>
  );
}

/**
 * One step, with its terminal.
 *
 * A step that ran a command opens with that command and its output in view.
 * The transcript is the only place the sandbox's work survives the turn, and a
 * row that folds itself shut the moment it completes is why a finished run
 * looked like it had done nothing. Collapsing stays the reader's call, and the
 * open state is local so a re-render does not force it back open.
 */
function StepRow({ step }: { step: StepLine }) {
  const hasConsole = Boolean(step.command || step.output);
  const [open, setOpen] = useState(hasConsole);

  return (
    <li className="agent-step" data-state={step.state}>
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span aria-hidden="true" className="agent-step-icon">
            {step.state === "start"
              ? "…"
              : step.state === "error"
                ? "✕"
                : hasConsole
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
  );
}

function StepList({ steps, live = false }: { steps: StepLine[]; live?: boolean }) {
  return (
    <ol className="agent-steps" data-live={live ? "true" : "false"}>
      {steps.map((step, index) => (
        <StepRow key={`${step.detail}-${index}`} step={step} />
      ))}
    </ol>
  );
}

/**
 * Screenshots the sandbox returned, each with the line that describes it.
 *
 * The caption is the page's own status snapshot — title, HTTP status, viewport,
 * console error count — so the reader can tell a working page from a 500.
 */
function ShotStrip({ shots }: { shots: Shot[] }) {
  return (
    <div className="mt-2 space-y-2">
      {shots.map((shot, index) => (
        <figure
          key={`${shot.caption}-${index}`}
          className="overflow-hidden rounded-2xl border border-line bg-card"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:${shot.mime};base64,${shot.base64}`}
            alt={shot.caption}
            className="block w-full"
          />
          <figcaption className="border-t border-line px-3 py-1.5 text-[11px] text-low">
            {shot.caption}
          </figcaption>
        </figure>
      ))}
    </div>
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
