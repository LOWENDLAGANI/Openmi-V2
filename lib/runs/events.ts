/**
 * The streaming protocol, as data.
 *
 * Names are stable and versioned by their absence of change: the browser
 * switches on `kind`, and an unknown kind is ignored rather than fatal. Every
 * event is persisted before it is streamed, so a reconnect replays the same
 * frames instead of reconstructing them.
 *
 * Not EventSource: the client sends `Last-Event-ID` on a fetch reader it opened
 * itself, because the run stream needs the session cookie and an explicit
 * cursor, and EventSource offers neither.
 */

import { capPayload } from "./redact";
import { RUN_EVENT_MAX_BYTES } from "./limits";

export const RUN_EVENT_NAMES = [
  "run.started",
  "message.delta",
  "message.done",
  "tool.started",
  "tool.finished",
  "usage",
  "warning",
  "preview.ready",
  "run.finished",
  "run.error",
] as const;

export type RunEventName = (typeof RUN_EVENT_NAMES)[number];

export type RunEventRow = {
  seq: number;
  kind: string;
  payload: Record<string, unknown>;
  at: string;
};

/** Terminal kinds; the stream closes after the last one is drained. */
export const TERMINAL_EVENTS: readonly string[] = ["run.finished", "run.error"];

export function isTerminalEvent(kind: string): boolean {
  return TERMINAL_EVENTS.includes(kind);
}

/** One SSE frame, `id:` first so a reconnect can resume from it. */
export function sseFrame(event: RunEventRow): string {
  const payload = capPayload(event.payload ?? {}, RUN_EVENT_MAX_BYTES);
  const data = JSON.stringify(payload).replace(/\n/g, "\\n");

  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${data}\n\n`;
}

/**
 * A comment line, ignored by every SSE parser.
 *
 * Proxies close a stream that has been silent; 15 seconds of silence is normal
 * for a run that is installing dependencies.
 */
export function sseHeartbeat(): string {
  return ": keep-alive\n\n";
}

/** Opens the stream with a retry hint for the browser's own reconnection. */
export function sseOpen(): string {
  return "retry: 3000\n\n";
}

/**
 * The cursor from `Last-Event-ID` or `?after=`.
 *
 * Anything unreadable is 0 — replaying from the start is correct, just
 * repetitive. A negative cursor is clamped rather than trusted.
 */
export function parseLastEventId(value: string | null | undefined): number {
  if (typeof value !== "string") return 0;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

/** Whether a run status can still produce events. */
export function runIsLive(status: string): boolean {
  return status === "queued" || status === "running";
}

/**
 * A short, human line for a tool call, shown instead of chain-of-thought.
 *
 * The reader sees what the agent is doing — "editing src/app/page.tsx" — never
 * the model's private reasoning, which is not streamed at all.
 */
export function toolSummary(name: string, args: Record<string, unknown> | null): string {
  const value = (key: string) =>
    args && typeof args[key] === "string" ? String(args[key]) : null;

  if (name === "read_file") return `reading ${value("path") ?? "a file"}`;
  if (name === "write_file") return `writing ${value("path") ?? "a file"}`;
  if (name === "edit_file") return `editing ${value("path") ?? "a file"}`;
  if (name === "search_code") return `searching for ${JSON.stringify(value("query") ?? "")}`;
  if (name === "run_command") {
    const command = value("command") ?? "";
    return `running ${command.length > 80 ? `${command.slice(0, 77)}…` : command}`;
  }
  if (name === "todo") return "updating the plan";
  return name;
}

/**
 * Why a run stopped, as a sentence the UI can show.
 *
 * `stop_reason` is stored, so this is a view over the recorded fact; an unknown
 * reason falls back to the status rather than inventing a cause.
 */
export function stopSentence(status: string, stopReason: string | null): string {
  if (stopReason === "answer") return "Finished.";
  if (stopReason === "max-steps") return "Stopped at the step limit.";
  if (stopReason === "token-budget") return "Stopped at the token budget.";
  if (stopReason === "wall-clock") return "Stopped at the time limit.";
  if (stopReason === "cancelled") return "Cancelled.";
  if (stopReason === "error") return "Failed.";
  if (status === "done") return "Finished.";
  if (status === "cancelled") return "Cancelled.";
  if (status === "failed") return "Failed.";
  if (status === "blocked") return "Stopped at a limit.";
  if (status === "queued") return "Waiting for a worker.";
  return "Running.";
}
