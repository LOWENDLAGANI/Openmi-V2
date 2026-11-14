/**
 * The caps a run is held to, in one pure place.
 *
 * A limit that lives only in a prompt is a suggestion. These numbers are read
 * by the route that queues a run, the worker that executes it, and the UI that
 * shows what is left — so they cannot drift apart. Every one is exported and
 * asserted in tests/runs.test.ts.
 */

/** One run stops at this many model steps, tool calls included. */
export const RUN_MAX_STEPS = 40;

/** Estimated tokens one run may spend. `ceil(chars / 4)` is the estimate. */
export const RUN_MAX_TOKENS = 120_000;

/** Wall clock, from claim to teardown. The sandbox is killed at the same edge. */
export const RUN_WALL_CLOCK_MS = 15 * 60_000;

/**
 * The workspace outlives the run.
 *
 * A run executes for at most fifteen minutes. At that point its sandbox is
 * **paused** — compute released, disk kept — not killed. It is destroyed
 * forty-eight hours after the run settled, by the sweep, which is the same
 * contract a chat workspace already has.
 *
 * The provider timeout is the pause trigger; the 48 hours is our own rule,
 * read by `sweepRunSandboxes`. Both numbers are exported so the docs, the
 * sweep and the sandbox factory read one source.
 */
export const RUN_SANDBOX_IDLE_MINUTES = 15;
export const RUN_SANDBOX_TTL_HOURS = 48;
export const RUN_SANDBOX_MIN_TTL_HOURS = 1;
export const RUN_SANDBOX_MAX_TTL_HOURS = 168;

/** `RUN_SANDBOX_IDLE_MINUTES`, clamped so a typo cannot buy a long-lived box. */
export function runSandboxIdleMinutes(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(env.RUN_SANDBOX_IDLE_MINUTES ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return RUN_SANDBOX_IDLE_MINUTES;
  return Math.min(60, Math.max(1, Math.trunc(raw)));
}

/** `RUN_SANDBOX_TTL_HOURS`, clamped to 1..168 (one week). */
export function runSandboxTtlHours(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(env.RUN_SANDBOX_TTL_HOURS ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return RUN_SANDBOX_TTL_HOURS;
  return Math.min(
    RUN_SANDBOX_MAX_TTL_HOURS,
    Math.max(RUN_SANDBOX_MIN_TTL_HOURS, Math.trunc(raw))
  );
}

/** When a settled run's workspace falls due for destruction. */
export function runSandboxExpiresAt(
  settledAt: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): number | null {
  if (!settledAt) return null;
  const settled = Date.parse(settledAt);
  if (!Number.isFinite(settled)) return null;
  return settled + runSandboxTtlHours(env) * 3_600_000;
}

/**
 * True when the 48 hours are up — or when there is no readable settlement
 * time, which is a row the sweep must not keep forever.
 */
export function runSandboxExpired(
  settledAt: string | null | undefined,
  now: number = Date.now(),
  env: Record<string, string | undefined> = process.env
): boolean {
  const expires = runSandboxExpiresAt(settledAt, env);
  return expires === null ? true : now >= expires;
}

/** Concurrent runs per account. Start at one; the queue is not a scheduler. */
export const RUN_MAX_CONCURRENT = 1;

/** Runs one account may start per UTC day. */
export const RUN_DAILY_RUNS = 20;

/** Tokens one account may spend per UTC day, across runs. */
export const RUN_DAILY_TOKENS = 400_000;

/**
 * A price per token, only so a run's cost can be charted. It is an estimate for
 * the operator's own dashboard, never a charge: Dew remains the billing unit.
 */
export const RUN_COST_PER_INPUT_TOKEN_USD = 0.15 / 1_000_000;
export const RUN_COST_PER_OUTPUT_TOKEN_USD = 0.6 / 1_000_000;

/** SSE behaviour: a heartbeat keeps proxies from closing an idle stream. */
export const RUN_STREAM_HEARTBEAT_MS = 15_000;
export const RUN_STREAM_POLL_MS = 400;
/** A stream closes here and the client reconnects with Last-Event-ID. */
export const RUN_STREAM_MAX_MS = 10 * 60_000;

/** Events carry previews, not archives. The full result is in the snapshot. */
export const RUN_EVENT_PREVIEW_CHARS = 400;
export const RUN_EVENT_MAX_BYTES = 16_000;

/** Tool caps. A refusal names the number; nothing is silently truncated. */
export const RUN_TOOL_OUTPUT_BYTES = 32_768;
export const RUN_READ_MAX_BYTES = 200_000;
export const RUN_READ_MAX_LINES = 400;
export const RUN_WRITE_MAX_CHARS = 200_000;
export const RUN_EDIT_MAX_BYTES = 400_000;
export const RUN_SEARCH_MAX_HITS = 40;
export const RUN_LIST_MAX = 200;
export const RUN_COMMAND_MAX_CHARS = 4_000;
export const RUN_COMMAND_TIMEOUT_MS = 120_000;

/** Artifacts: how much of a run's output is worth uploading. */
export const RUN_ARTIFACT_MAX_FILES = 40;
export const RUN_ARTIFACT_MAX_FILE_BYTES = 200_000;
export const RUN_DIFF_MAX_BYTES = 400_000;

/** Prompt budget: the file tree and project instructions are context, not noise. */
export const RUN_TREE_MAX_PATHS = 200;
export const RUN_TREE_MAX_CHARS = 6_000;
export const RUN_INSTRUCTIONS_MAX_CHARS = 8_000;

/**
 * Compaction. The context window is 128k tokens; at 80% the oldest exchanges
 * are dropped (never the system prompt or the first request) and the eviction
 * is reported, so nobody mistakes a compacted run for a complete one.
 */
export const RUN_CONTEXT_WINDOW_TOKENS = 128_000;
export const RUN_COMPACT_AT = 0.8;
export const RUN_COMPACT_TARGET_CHARS = Math.floor(
  RUN_CONTEXT_WINDOW_TOKENS * RUN_COMPACT_AT * 4
);

/** Milliseconds a run may be silent before the reaper calls it crashed. */
export const RUN_STALE_AFTER_MS = RUN_WALL_CLOCK_MS + 5 * 60_000;

/** `RUN_MAX_MINUTES` is an operator knob, clamped so a typo cannot buy an hour. */
export function runMaxMinutes(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(env.RUN_MAX_MINUTES ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return 15;
  return Math.min(30, Math.max(1, Math.trunc(raw)));
}

export function runWallClockMs(
  env: Record<string, string | undefined> = process.env
): number {
  return runMaxMinutes(env) * 60_000;
}

/** How many runs one worker executes at once. */
export function workerConcurrency(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(env.RUN_WORKER_CONCURRENCY ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return 2;
  return Math.min(8, Math.max(1, Math.trunc(raw)));
}

/** `ceil(chars / 4)`: the same estimate the chat path uses. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function runCostUsd(inputTokens: number, outputTokens: number): number {
  const cost =
    Math.max(0, inputTokens) * RUN_COST_PER_INPUT_TOKEN_USD +
    Math.max(0, outputTokens) * RUN_COST_PER_OUTPUT_TOKEN_USD;

  // Six decimals is the column's precision; round here rather than in SQL.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export type RunQuotaInput = {
  active: number;
  runsToday: number;
  tokensToday: number;
};

export type RunQuotaDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: "concurrency" | "daily-runs" | "daily-tokens";
      message: string;
    };

/**
 * The gate a new run passes before it is queued.
 *
 * Order matters for the message, not the decision: concurrency is the one the
 * reader can fix by waiting a minute, so it is reported first.
 */
export function checkRunQuota(input: RunQuotaInput): RunQuotaDecision {
  if (input.active >= RUN_MAX_CONCURRENT) {
    return {
      allowed: false,
      code: "concurrency",
      message:
        "You already have a run in progress. Wait for it to finish, or cancel it first.",
    };
  }

  if (input.runsToday >= RUN_DAILY_RUNS) {
    return {
      allowed: false,
      code: "daily-runs",
      message: `This account has used all ${RUN_DAILY_RUNS} runs for today. The budget resets at midnight UTC.`,
    };
  }

  if (input.tokensToday >= RUN_DAILY_TOKENS) {
    return {
      allowed: false,
      code: "daily-tokens",
      message: `This account has used its ${RUN_DAILY_TOKENS.toLocaleString()}-token budget for today. The budget resets at midnight UTC.`,
    };
  }

  return { allowed: true };
}

/**
 * Drops the oldest exchanges until the prompt fits.
 *
 * The system prompt and the first user request stay: they are what the run is
 * about. Tool pairs are dropped in whole exchanges so a `tool` message never
 * outlives the assistant call that asked for it. The return value says how many
 * messages went, which the caller reports as a `warning` event.
 */
export function compactMessages<T extends { role: string; content: string }>(
  messages: T[],
  budgetChars: number = RUN_COMPACT_TARGET_CHARS
): { messages: T[]; evicted: number; chars: number } {
  const size = (list: T[]) =>
    list.reduce((total, message) => total + message.content.length, 0);

  let chars = size(messages);
  if (chars <= budgetChars || messages.length <= 3) {
    return { messages, evicted: 0, chars };
  }

  const head = messages.slice(0, 2);
  let tail = messages.slice(2);
  let evicted = 0;
  chars -= size(head);

  while (tail.length > 0 && chars > budgetChars - size(head)) {
    const drop = Math.max(2, Math.ceil(tail.length / 4));
    tail = tail.slice(drop);
    evicted += drop;
    chars = size(tail);
  }

  // Never leave a tool result without its assistant call: a provider rejects a
  // conversation that starts with one.
  while (tail.length > 0 && tail[0].role === "tool") {
    tail = tail.slice(1);
    evicted += 1;
  }

  const kept = [...head, ...tail];
  return { messages: kept, evicted, chars: size(kept) };
}
