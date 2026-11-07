/**
 * One Auto answer, several models.
 *
 * The pipeline walks Auto's queue and yields a single stream of text. A failure
 * before the first character moves to the next model with the original request;
 * a failure after it moves to the next model with the text written so far and the
 * continuation directive. Either way the reader sees one uninterrupted answer,
 * and nothing about the handover is reported to them.
 *
 * Two rules keep that honest:
 *
 * - The user's own Stop is not a failure. An aborted turn stops and says it was
 *   stopped; it does not quietly spend another model on an answer nobody is
 *   waiting for.
 * - An endpoint that adds nothing to a continuation has not continued. It counts
 *   as a failed attempt, so the queue moves on instead of settling a truncated
 *   answer as complete.
 */

import type { ModelId } from "../models";
import {
  continuationMessages,
  overlapGate,
  type RoutedMessage,
} from "./continuation";

/** The shape both the plain and the tool-calling provider streams accept. */
export type { RoutedMessage } from "./continuation";

export type RoutedTarget = {
  /** The model id, for tests and logs. Never shown to the reader. */
  id: ModelId;
  /**
   * One streamed attempt. `messages` is already the continuation request when a
   * partial answer exists; the target does not have to know which it got.
   */
  stream: (input: {
    messages: RoutedMessage[];
    signal: AbortSignal;
  }) => AsyncGenerator<string>;
};

export type RoutedEvent =
  | { type: "delta"; text: string }
  | {
      type: "settled";
      /** False when the queue ran out before the answer was finished. */
      complete: boolean;
      /** How many endpoints were asked, including the one that answered. */
      attempts: number;
    };

/**
 * How many endpoints one turn may ask.
 *
 * Auto's pool is fifty free models, and a free model may be rate limited,
 * unavailable, or drop mid-stream. The turn walks the queue until one answers,
 * so the cap is the pool size. The function's wall clock and the abort signal
 * remain the real bound on a slow pool.
 */
export const MAX_ROUTED_ATTEMPTS = 50;

export type StreamRoutedOptions = {
  targets: readonly RoutedTarget[];
  messages: readonly RoutedMessage[];
  signal: AbortSignal;
  maxAttempts?: number;
};

export async function* streamRouted({
  targets,
  messages,
  signal,
  maxAttempts = MAX_ROUTED_ATTEMPTS,
}: StreamRoutedOptions): AsyncGenerator<RoutedEvent> {
  if (targets.length === 0) {
    throw new Error("No model is available to answer right now.");
  }

  const attempts = Math.max(1, Math.min(maxAttempts, targets.length));

  let produced = "";
  let lastError: unknown = null;

  for (let index = 0; index < attempts; index += 1) {
    const target = targets[index];
    if (!target) break;

    // A fresh gate per attempt: the overlap is against what the reader has,
    // not against what an earlier attempt's gate happened to buffer.
    const gate = overlapGate(produced);
    const before = produced;

    try {
      for await (const delta of target.stream({
        messages: continuationMessages(messages, produced),
        signal,
      })) {
        const text = gate.push(delta);
        if (text.length === 0) continue;

        produced += text;
        yield { type: "delta", text };
      }

      // Whatever the gate was still holding belongs to the answer too: a
      // continuation shorter than the lookahead never diverged on its own.
      const tail = gate.flush();
      if (tail.length > 0) {
        produced += tail;
        yield { type: "delta", text: tail };
      }
    } catch (caught) {
      lastError = caught;
      // Stopping is the reader's decision, not a provider failure.
      if (signal.aborted) throw caught;
      continue;
    }

    if (produced === before && before.length > 0) {
      // The endpoint streamed only text that was already sent. That is not a
      // continuation, so the next endpoint is asked instead of settling it.
      lastError = new Error("The model repeated the partial answer.");
      continue;
    }

    yield { type: "settled", complete: true, attempts: index + 1 };
    return;
  }

  if (produced.length > 0) {
    yield { type: "settled", complete: false, attempts };
    return;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Every model in the queue failed.");
}
