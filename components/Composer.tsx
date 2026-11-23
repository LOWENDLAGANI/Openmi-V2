"use client";

import { ArrowUp, Square } from "lucide-react";
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

const MESSAGE_WARN_CHARS = Math.floor(MAX_MESSAGE_CHARS * 0.9);

export type ContextMeter = {
  usedChars: number;
  budgetChars: number;
  notes: string[];
};

export type ComposerCommand = { text: string; nonce: number };

/**
 * The message composer. Draft state lives locally so typing never re-renders
 * the transcript above it.
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
  backgroundRunning = false,
  stopping,
  providerReady,
  command,
  onSend,
  onStop,
}: {
  models: ModelCapability[];
  model: ModelId;
  onModelChange: (id: string) => void;
  effort: ReasoningEffort;
  onEffortChange: (effort: ReasoningEffort) => void;
  meter: ContextMeter | null;
  activeChatId: string | null;
  repo?: string | null;
  paidActive: boolean;
  streaming: boolean;
  backgroundRunning?: boolean;
  stopping: boolean;
  providerReady: boolean;
  command: ComposerCommand;
  onSend: (content: string) => void;
  onStop: () => void;
}) {
  const repoName = repo ? (repo.split("/").pop() ?? repo) : null;
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (command.nonce === 0) return;
    setText(command.text);
    textareaRef.current?.focus();
  }, [command]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [text]);

  const isRunning = streaming || backgroundRunning;
  const tooLong = text.length > MAX_MESSAGE_CHARS;
  const canSend = !isRunning && !tooLong && text.trim().length > 0;
  const hourCost = modelHourCredit(model, models);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    onSend(text);
  }

  return (
    <form onSubmit={submit}>
      <div className="composer-card">
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
          className="composer-input max-h-[168px] min-h-[56px] w-full px-3.5 pb-1.5 pt-3 text-[14.5px] leading-snug focus:outline-none"
        />

        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
          <div className="flex min-w-0 items-center gap-1.5 overflow-visible">
            <ModelMenu
              models={models}
              value={model}
              onChange={(id) => onModelChange(id as ModelId)}
              paidActive={paidActive}
            />

            {modelSupportsEffort(model) && (
              <EffortMenu value={effort} onChange={onEffortChange} />
            )}
          </div>

          <div className="flex min-w-0 shrink-0 items-center gap-1.5">
            <span
              title={
                activeChatId !== null
                  ? "Every message in this chat is covered for the hour."
                  : "The hour starts when the first message sends."
              }
              className="hidden rounded-md border border-line bg-raised px-2 py-1 font-mono text-[10.5px] tabular-nums text-low sm:inline-flex"
            >
              {activeChatId !== null
                ? hourCost === 0
                  ? "free turn"
                  : `${hourCost} credit / hr`
                : hourCost === 0
                  ? "auto · free"
                  : `${hourCost} credit on send`}
            </span>

            {meter && (
              <ContextCircle
                usedChars={meter.usedChars}
                budgetChars={meter.budgetChars}
                notes={meter.notes}
              />
            )}

            {isRunning && (
              <button
                type="button"
                onClick={onStop}
                disabled={stopping}
                aria-label={stopping ? "Stopping the turn" : "Stop the turn"}
                title={stopping ? "Stopping…" : "Stop"}
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-line-strong bg-card text-hi transition-colors hover:bg-hover disabled:opacity-60"
              >
                <Square
                  aria-hidden="true"
                  className={`size-3.5 fill-current ${stopping ? "animate-blink" : ""}`}
                />
              </button>
            )}

            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              className={`grid size-8 shrink-0 place-items-center rounded-lg transition-colors ${
                canSend
                  ? "bg-accent text-on-accent hover:opacity-95"
                  : "send-idle"
              }`}
            >
              <ArrowUp aria-hidden="true" className="size-4" strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[11px] text-low">
        <span className="hidden sm:inline">
          Enter to send · Shift + Enter for new line
        </span>
        {text.length > MESSAGE_WARN_CHARS && (
          <span
            className={`ml-auto font-mono tabular-nums ${
              text.length > MAX_MESSAGE_CHARS ? "text-danger" : "text-low"
            }`}
          >
            {text.length.toLocaleString()} /{" "}
            {MAX_MESSAGE_CHARS.toLocaleString()} chars
          </span>
        )}
      </div>
    </form>
  );
}
