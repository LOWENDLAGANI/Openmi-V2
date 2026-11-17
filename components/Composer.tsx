"use client";

import { useEffect, useRef, useState } from "react";

import { ContextCircle } from "@/components/ContextCircle";
import { EffortMenu } from "@/components/EffortMenu";
import { ModelMenu } from "@/components/ModelMenu";
import { MAX_MESSAGE_CHARS } from "@/lib/chat-limits";
import {
  modelHourCredit,
  modelSupportsEffort,
  type ModelCapability,
  type ModelId,
  type ReasoningEffort,
} from "@/lib/models";

/** How close to the server's cap the counter appears, so it is not noise. */
const MESSAGE_WARN_CHARS = Math.floor(MAX_MESSAGE_CHARS * 0.9);

export type ContextMeter = {
  usedChars: number;
  budgetChars: number;
  notes: string[];
};

/**
 * A value handed to the composer: an edited message, or an empty field after a
 * send. `nonce` makes the same text count twice, because a second edit of the
 * same message still has to replace what is in the field.
 */
export type ComposerCommand = { text: string; nonce: number };

/**
 * The message field.
 *
 * The draft is state here rather than in `ChatPanel`, because a keystroke in a
 * field that lives in the transcript's component re-renders the transcript: on
 * a long chat that is hundreds of bubbles and syntax-highlighted blocks per
 * character, which is exactly the input delay web.dev's INP budget measures. The
 * parent still starts sends and hands in edited text; it just no longer renders
 * once per keystroke to do it.
 */
export function Composer({
  models,
  model,
  onModelChange,
  effort,
  onEffortChange,
  meter,
  activeChatId,
  repo,
  paidActive,
  streaming,
  stopping,
  providerReady,
  command,
  onSend,
  onStop,
}: {
  models: ModelCapability[];
  model: ModelId;
  onModelChange: (id: string) => void;
  /** The thinking effort the next message will ask for. */
  effort: ReasoningEffort;
  onEffortChange: (effort: ReasoningEffort) => void;
  meter: ContextMeter | null;
  activeChatId: string | null;
  /** The repository this chat is pinned to, for the placeholder. */
  repo?: string | null;
  /** Whether a paid pass is live; the picker marks the models that need one. */
  paidActive: boolean;
  streaming: boolean;
  stopping: boolean;
  providerReady: boolean;
  command: ComposerCommand;
  onSend: (content: string) => void;
  onStop: () => void;
}) {
  // Named in the placeholder: a field that says what it can see invites a
  // question it can answer, and a blank "Ask anything" invites one it cannot.
  const repoName = repo ? (repo.split("/").pop() ?? repo) : null;
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Adopt whatever the parent handed in, and focus the field it landed in.
  useEffect(() => {
    if (command.nonce === 0) return;
    setText(command.text);
    textareaRef.current?.focus();
  }, [command]);

  // A composer that grows with the question instead of showing a scrollbar
  // after two lines.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [text]);

  // The count below is a warning, but the cap is the server's: sending past it
  // is refused after the field has already been cleared, which loses the draft
  // a reader spent minutes writing. The button refuses it first.
  const tooLong = text.length > MAX_MESSAGE_CHARS;
  const canSend = !streaming && !tooLong && text.trim().length > 0;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    onSend(text);
  }

  return (
    <form onSubmit={submit}>
      {/* The model and the hour's price sit above the capsule, the way the
          reference parks its context ring there: a message field with four
          chips inside it stops reading as one field. */}
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <ModelMenu
            models={models}
            value={model}
            onChange={(id) => onModelChange(id as ModelId)}
            paidActive={paidActive}
          />

          {/* Effort only exists where the provider documents it, so the control
              appears with the model instead of sitting there doing nothing. */}
          {modelSupportsEffort(model) && (
            <EffortMenu value={effort} onChange={onEffortChange} />
          )}
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          {/* What the next message costs, so the price is never a surprise
              after the answer. */}
          <span
            title={
              activeChatId !== null
                ? "Every message in this chat is covered for the hour."
                : "The hour starts when the first message sends."
            }
            className="hidden items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1 text-[9.5px] text-low sm:inline-flex"
          >
            <span
              aria-hidden="true"
              className={`size-1 rounded-full ${
                activeChatId !== null ? "bg-accent" : "bg-line-strong"
              }`}
            />
            {activeChatId !== null
              ? `hour · ${modelHourCredit(model, models)} credit`
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
      </div>

      {/* One owned surface, not a glowing frame: the capsule is the same
          control at rest, on focus and while streaming. */}
      <div className="composer-capsule flex items-end gap-1 px-2 py-1.5">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!canSend) return;
                onSend(text);
              }
            }}
            rows={1}
            placeholder={
              providerReady
                ? repoName
                  ? `Ask about ${repoName}…`
                  : "Ask what to build, or attach a repository…"
                : "Chat is unavailable right now."
            }
            className="composer-input max-h-[168px] min-h-[40px] flex-1 px-2 py-2.5 text-[15px] leading-snug focus:outline-none"
          />

          <div className="flex shrink-0 items-center gap-1.5">
            {streaming && (
              <button
                type="button"
                onClick={onStop}
                disabled={stopping}
                aria-label={stopping ? "Stopping the turn" : "Stop the turn"}
                title={stopping ? "Stopping…" : "Stop"}
                className="lift mb-0.5 grid size-10 shrink-0 place-items-center rounded-full border border-line-strong text-hi hover:bg-hover disabled:opacity-60"
              >
                <span
                  aria-hidden="true"
                  className={`size-3 rounded-[3px] bg-current ${
                    stopping ? "animate-blink" : ""
                  }`}
                />
              </button>
            )}

            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              className={`lift mb-0.5 grid size-10 shrink-0 place-items-center rounded-full transition-colors ${
                canSend ? "bg-accent text-on-accent" : "send-idle"
              }`}
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

      {/* The keyboard convention is stated once, where it is used, and hidden
          on a touch layout where Enter is a newline and only the button sends.
          The over-cap count sits on the same line: the send button refuses the
          message, so the number appears before the press, not as an error
          after it. */}
      <div className="mt-1 flex items-center justify-between gap-2 px-2 text-[10px] text-low">
        <span className="hidden sm:inline">
          Enter to send · Shift + Enter for a new line
        </span>
        {text.length > MESSAGE_WARN_CHARS && (
          <span
            className={`ml-auto tabular-nums ${
              text.length > MAX_MESSAGE_CHARS ? "text-danger" : "text-low"
            }`}
          >
            {text.length.toLocaleString()} /{" "}
            {MAX_MESSAGE_CHARS.toLocaleString()} characters
          </span>
        )}
      </div>
    </form>
  );
}
