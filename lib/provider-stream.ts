/**
 * Reading a provider's stream without guessing.
 *
 * This module is pure on purpose: `lib/providers.ts` is `server-only` because it
 * holds API keys, and the frame parsing is the part that most needs a test. So
 * the reading lives here and the request lives there.
 *
 * The bug it exists for: DeepSeek's thinking mode is on by default, and its
 * chain of thought streams in `reasoning_content` while the answer streams in
 * `content`. Reading only `content` made a working model look silent, and every
 * turn ended as "the provider returned an empty answer".
 */

/** The reply budget per request for a model that answers straight away. */
export const MAX_COMPLETION_TOKENS = 2_000;

/**
 * The reply budget for a model that thinks first.
 *
 * On DeepSeek the chain of thought is billed from the same budget as the answer,
 * so 2,000 tokens can be spent entirely on thinking and the reader sees nothing.
 * The extra room is what makes "reasoning is shown, and then there is an answer"
 * true instead of a coin flip.
 */
export const MAX_REASONING_COMPLETION_TOKENS = 8_000;

export class ProviderError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

/**
 * A stream that ended without an answer.
 *
 * Separate from `ProviderError` for one reason: rotating to another key cannot
 * help. The request reached the model and the model replied nothing usable, so
 * retrying the same turn with the next key only spends it too.
 */
export class EmptyCompletionError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = "EmptyCompletionError";
  }
}

/** One parsed stream frame. */
export type StreamDeltaFrame = {
  content?: string;
  reasoning?: string;
  toolCalls?: Array<{
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  }>;
  finishReason?: string;
};

/**
 * Reads one `data:` frame. `null` means "not something we can use".
 *
 * `reasoning_content` is DeepSeek's spelling; `reasoning` is what several other
 * OpenAI-compatible servers call the same field, so both are read. A frame is
 * never dropped because it carries no `content`: a thought is still something
 * the model said, and it is what the transcript shows behind the fold.
 */
export function readDelta(payload: string): StreamDeltaFrame | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch {
    // Keepalives and provider-specific frames are not answers. Skipping a frame
    // we cannot read is honest; inventing text from it is not.
    return null;
  }

  const choice = (
    parsed as {
      choices?: Array<{
        delta?: {
          content?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
          tool_calls?: unknown;
        };
        finish_reason?: unknown;
      }>;
    }
  )?.choices?.[0];

  if (!choice) return null;

  const frame: StreamDeltaFrame = {};
  const delta = choice.delta ?? {};

  if (typeof delta.content === "string" && delta.content.length > 0) {
    frame.content = delta.content;
  }

  const reasoning =
    typeof delta.reasoning_content === "string"
      ? delta.reasoning_content
      : typeof delta.reasoning === "string"
        ? delta.reasoning
        : "";

  if (reasoning.length > 0) frame.reasoning = reasoning;

  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
    frame.toolCalls = delta.tool_calls.map((raw, position) => {
      const call = (raw ?? {}) as {
        index?: unknown;
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };

      return {
        index: typeof call.index === "number" ? call.index : position,
        ...(typeof call.id === "string" ? { id: call.id } : {}),
        ...(typeof call.function?.name === "string"
          ? { name: call.function.name }
          : {}),
        ...(typeof call.function?.arguments === "string"
          ? { arguments: call.function.arguments }
          : {}),
      };
    });
  }

  if (typeof choice.finish_reason === "string") {
    frame.finishReason = choice.finish_reason;
  }

  return frame;
}

/**
 * Turns "the stream ended" into a sentence the reader can act on.
 *
 * `sawAnswer` counts text *and* tool calls: a step that only asked to run a
 * command is a complete step, not an empty one. Reaching here with neither is a
 * real failure, and the causes have different fixes — so they get different
 * messages instead of one blank "empty answer".
 */
export function assertAnswer(input: {
  sawAnswer: boolean;
  sawReasoning: boolean;
  finishReason: string | null;
}): void {
  if (input.sawAnswer) return;

  if (input.sawReasoning) {
    throw new EmptyCompletionError(
      "The model streamed its reasoning but no answer — its reply budget ran out first. Try a shorter message."
    );
  }

  if (input.finishReason === "length") {
    throw new EmptyCompletionError(
      `The model used all ${MAX_COMPLETION_TOKENS} reply tokens before writing anything. Try a shorter message.`
    );
  }

  throw new EmptyCompletionError(
    "The provider closed the stream without sending any text."
  );
}

/**
 * The reply budget for this provider.
 *
 * A thinking model spends the same budget on its reasoning before it writes a
 * word, so it is given room for both. Every other provider keeps the smaller
 * budget, because a longer answer is not a better one.
 */
export function completionBudget(provider: {
  thinksByDefault?: boolean;
}): number {
  return provider.thinksByDefault
    ? MAX_REASONING_COMPLETION_TOKENS
    : MAX_COMPLETION_TOKENS;
}
