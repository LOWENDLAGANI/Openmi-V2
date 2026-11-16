// When a charged hour is refunded.
//
// The hour is charged before the first provider request. A turn that fails is
// refunded even when it had already streamed part of an answer, because an
// interrupted answer is not the hour that was paid for. Both the plain and the
// agent chat paths use this one decision, so they cannot drift apart.
//
// Staying charged: a finished answer, a stop after tokens had arrived (the
// reader got part of the answer by choice), a paused turn that continues on the
// same charge, and a turn that ended on its step budget because the work it did
// is already saved for the next message.

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
  if (!Number.isFinite(input.textLength)) return null;

  const partial = input.textLength > 0;

  switch (input.stopped) {
    case "paused":
    case "steps":
      return null;
    case "error":
      return partial
        ? "the provider failed before finishing"
        : "the provider failed before answering";
    case "conflict":
      return partial ? "the turn could not finish" : "the turn could not advance";
    case "aborted":
      return partial ? null : "you stopped it before the first token";
    default:
      return partial ? null : "the provider returned an empty answer";
  }
}
