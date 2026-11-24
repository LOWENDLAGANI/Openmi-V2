/**
 * The caps a run is held to, in one pure place.
 *
 * A limit that lives only in a prompt is a suggestion. These numbers are read
 * by the route that queues a run, the worker that executes it, and the UI that
 * shows what is left — so they cannot drift apart. Every one is exported and
 * asserted in tests/runs.test.ts.
 */

/** One run stops at this many model steps, tool calls included. */
export const RUN_MAX_STEPS = 70;

/** Estimated tokens one run may spend. `ceil(chars / 4)` is the estimate. */
export const RUN_MAX_TOKENS = 2_000_000;

/** Wall clock, from claim to teardown. The sandbox is paused at the same edge. */
export const RUN_WALL_CLOCK_MS = 30 * 60_000;

/**
 * The workspace outlives the run.
 *
 * A run executes for at most thirty minutes by default. At that point its sandbox is
 * **paused** — compute released, disk kept — not killed. It is destroyed
 * forty-eight hours after the run settled, by the sweep, which is the same
 * contract a chat workspace already has.
 *
 * The provider timeout is the pause trigger; the 48 hours is our own rule,
 * read by `sweepRunSandboxes`. Both numbers are exported so the docs, the
 * sweep and the sandbox factory read one source.
 */
export const RUN_SANDBOX_IDLE_MINUTES = 30;
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
export const RUN_DAILY_TOKENS = 3_000_000;

/**
 * A price per token, only so a run's cost can be charted. It is an estimate for
 * the operator's own dashboard, never a charge: Credit remains the billing unit.
 */
export const RUN_COST_PER_INPUT_TOKEN_USD = 0.15 / 1_000_000;
export const RUN_COST_PER_OUTPUT_TOKEN_USD = 0.6 / 1_000_000;

/** SSE behaviour: a heartbeat keeps proxies from closing an idle stream. */
export const RUN_STREAM_HEARTBEAT_MS = 15_000;
export const RUN_STREAM_POLL_MS = 400;
/** How often the worker checks whether a running run was cancelled. */
export const RUN_CANCEL_POLL_MS = 1_000;
/** A stream closes here and the client reconnects with Last-Event-ID. */
export const RUN_STREAM_MAX_MS = 10 * 60_000;

/** Events carry previews, not archives. The full result is in the snapshot. */
export const RUN_EVENT_PREVIEW_CHARS = 400;

/**
 * How much of a run's event log a reloaded tab reads to rebuild its progress.
 *
 * Steps and answer text arrive as separate events, so this caps both: it is
 * comfortably more than a forty-step run flushes, and a run that outgrew it
 * still shows every step it took and the answer it had written so far.
 */
export const RUN_PROGRESS_EVENTS = 600;
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
export const RUN_CONTEXT_WINDOW_TOKENS = 1_000_000;
export const RUN_COMPACT_AT = 0.8;
export const RUN_COMPACT_TARGET_CHARS = Math.floor(
  RUN_CONTEXT_WINDOW_TOKENS * RUN_COMPACT_AT * 4
);

/** Milliseconds a run may be silent before the reaper calls it crashed. */
export const RUN_STALE_AFTER_MS = RUN_WALL_CLOCK_MS + 5 * 60_000;

/**
 * When a run stops being "in progress" for the reader.
 *
 * A queued row older than this was never claimed — a full fifteen-minute run,
 * plus the queue behind it, fits inside twenty — and a running row whose
 * heartbeat is older than five minutes has lost its worker. The migration that
 * settles stalls, the page that reads the spinner, the poll that ends a
 * reloaded tab's wait and the stream that reports it all use these two ages, so
 * they cannot drift apart.
 */
export const RUN_QUEUE_WAIT_MS = 20 * 60_000;
export const RUN_HEARTBEAT_STALE_MS = 5 * 60_000;

/**
 * A queued run says so after this long with no claim, instead of staying silent
 * until the queue's own twenty-minute rule fails it.
 */
export const RUN_QUEUE_NOTICE_MS = 20_000;

/**
 * How long the queue's wake-up ping waits for a first byte.
 *
 * The worker's host counts the request as traffic the moment it arrives, so an
 * instance that is still booting is already awake; waiting for its reply buys
 * nothing and would hold the turn open for the whole cold start.
 */
export const RUN_WAKE_TIMEOUT_MS = 1_500;

/** `RUN_MAX_MINUTES` is an operator knob, clamped to 1..60 minutes. */
export function runMaxMinutes(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(env.RUN_MAX_MINUTES ?? "");
  if (!Number.isFinite(raw) || raw <= 0) return 30;
  return Math.min(60, Math.max(1, Math.trunc(raw)));
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

/**
 * The next midnight UTC: when the daily run and token budgets start over.
 *
 * The limits are counted per UTC day, so the reset is a fixed instant rather
 * than "a day after the first run". The refusal quotes this instead of making
 * the reader work out the remaining hours themselves.
 */
export function dailyBudgetResetAt(now: number = Date.now()): number {
  const at = new Date(now);
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
}

/** "4h 12m", "37m" or "less than a minute": a duration, not a timestamp. */
export function formatResetIn(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes <= 1) return "less than a minute";

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** The tail of a daily-budget refusal: when the budget is available again. */
export function dailyResetNote(now: number = Date.now()): string {
  return `It resets in ${formatResetIn(dailyBudgetResetAt(now) - now)} (at midnight UTC).`;
}

export type RunQuotaInput = {
  active: number;
  runsToday: number;
  tokensToday: number;
  /**
   * Admins, and accounts an admin granted unlimited, skip the daily run and
   * token budgets. Concurrency still applies: it protects the worker.
   */
  unlimited?: boolean;
  /** Test seam: the clock the reset countdown is measured from. */
  now?: number;
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

  if (input.unlimited === true) return { allowed: true };

  // One reading of the clock for both refusals, so a message cannot quote a
  // countdown measured twice.
  const reset = dailyResetNote(input.now);

  if (input.runsToday >= RUN_DAILY_RUNS) {
    return {
      allowed: false,
      code: "daily-runs",
      message: `This account has used all ${RUN_DAILY_RUNS} runs for today. ${reset}`,
    };
  }

  if (input.tokensToday >= RUN_DAILY_TOKENS) {
    return {
      allowed: false,
      code: "daily-tokens",
      message: `This account has used its ${RUN_DAILY_TOKENS.toLocaleString()}-token budget for today. ${reset}`,
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
