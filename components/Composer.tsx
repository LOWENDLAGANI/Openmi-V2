"use client";

import { useEffect, useRef, useState } from "react";

import { Beam } from "@/components/Beam";
import { ContextCircle } from "@/components/ContextCircle";
import { ModelMenu } from "@/components/ModelMenu";
import { MAX_MESSAGE_CHARS } from "@/lib/chat-limits";
import { modelHourDew, type ModelCapability, type ModelId } from "@/lib/models";

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
  meter,
  activeChatId,
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
  meter: ContextMeter | null;
  activeChatId: string | null;
  streaming: boolean;
  stopping: boolean;
  providerReady: boolean;
  command: ComposerCommand;
  onSend: (content: string) => void;
  onStop: () => void;
}) {
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

  const canSend = !streaming && text.trim().length > 0;

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
        <ModelMenu
          models={models}
          value={model}
          onChange={(id) => onModelChange(id as ModelId)}
        />

        <div className="flex min-w-0 items-center gap-1.5">
          {/* What the next message costs, so the price is never a surprise
              after the answer. */}
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
              ? `hour · ${modelHourDew(model, models)} dew`
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

      <Beam>
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
              providerReady ? "Ask anything…" : "Chat is unavailable right now."
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
      </Beam>

      {/* The send button refuses an over-cap message, so the count appears
          before the press instead of as an error after it. */}
      {text.length > MESSAGE_WARN_CHARS && (
        <p
          className={`mt-1 px-2 text-right font-mono text-[10px] ${
            text.length > MAX_MESSAGE_CHARS ? "text-danger" : "text-low"
          }`}
        >
          {text.length.toLocaleString()} /{" "}
          {MAX_MESSAGE_CHARS.toLocaleString()} characters
        </p>
      )}
    </form>
  );
}
