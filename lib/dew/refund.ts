// When a charged hour is refunded.
//
// The hour is charged before the first provider request, so it is refunded
// whenever that request produces no answer at all. Both the plain and the
// agent chat paths use this one decision, so they cannot drift apart.
//
// A paused turn is not a failure: it continues on the same charge. A turn that
// ended on its step budget is not refunded either, because the work it did is
// already saved for the next message.

export type TurnOutcome =
  | "done"
  | "steps"
  | "tokens"
  | "paused"
  | "aborted"
  | "error"
  | "conflict";

/**
 * A human-readable refund reason, or null when the hour stays charged.
 * Returned without a full stop so callers can put it in a sentence.
 */
export function refundReasonFor(input: {
  textLength: number;
  stopped: TurnOutcome | string;
}): string | null {
  if (!Number.isFinite(input.textLength) || input.textLength > 0) return null;

  switch (input.stopped) {
    case "paused":
      return null;
    case "steps":
      return null;
    case "aborted":
      return "you stopped it before the first token";
    case "error":
      return "the provider failed before answering";
    case "conflict":
      return "the turn could not advance";
    default:
      return "the provider returned an empty answer";
  }
}
