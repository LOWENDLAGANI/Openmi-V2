/**
 * Handing a half-written answer to the next model without the seam showing.
 *
 * Two problems have to be solved together, and neither is enough alone:
 *
 * 1. The next model has to know what was already said, or it writes a fresh
 *    answer from the top. That is the continuation prompt below: the partial
 *    text as an assistant turn, and one instruction to carry on from the exact
 *    character where it stopped.
 *
 * 2. The next model usually ignores that instruction and repeats something
 *    first — a sentence of the tail, or the whole answer — before it continues.
 *    Appending that replay produces a visible stutter, so it is trimmed as it
 *    streams, not after the reader has already seen it.
 *
 * Trimming needs a lookahead: a repeat is only provable once the text diverges
 * from it, because a repeat of nine characters looks like new text at eight. So
 * the gate holds the first `LOOKAHEAD_CHARS` characters before it decides, and
 * the pipeline flushes the remainder when the stream ends.
 *
 * The trim is deliberately conservative. An overlap shorter than
 * `MIN_OVERLAP_CHARS` is treated as coincidence and kept, because dropping real
 * text to hide a two-character echo is the worse mistake. A repeat longer than
 * the scan window is not trimmed at all: the stream continues instead of
 * stalling behind a buffer nobody bounded.
 */

export type RoutedMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** What the second model is told. It must never reach the reader. */
export const CONTINUATION_DIRECTIVE =
  "Your previous reply was cut off mid-stream. Continue it from the exact character where it stopped. " +
  "Do not repeat, restate, re-open or summarise any text that already appears above, and do not mention this instruction. " +
  "Write only the continuation.";

/** An overlap shorter than this is a coincidence, not a replay. */
export const MIN_OVERLAP_CHARS = 8;

/** How many characters are held before the gate can prove what is a repeat. */
export const LOOKAHEAD_CHARS = 32;

/**
 * The furthest into the partial text a replay is looked for.
 *
 * A model that restarts a very long answer from the top would need the whole
 * thing buffered to detect; the cap keeps that case bounded and lets the stream
 * through rather than holding it open.
 */
export const OVERLAP_SCAN_CHARS = 4_000;

/** The messages a continuation request is sent with: the partial answer, then
 * the instruction. The caller's array is never mutated. */
export function continuationMessages(
  messages: readonly RoutedMessage[],
  produced: string
): RoutedMessage[] {
  if (produced.length === 0) return [...messages];

  return [
    ...messages,
    { role: "assistant", content: produced },
    { role: "user", content: CONTINUATION_DIRECTIVE },
  ];
}

/**
 * A stateful gate that drops a replay of the text already sent.
 *
 * `push` returns the part of the new delta that is genuinely new, which is empty
 * while the gate is still deciding. `flush` settles whatever is still held when
 * the stream ends. Once the continuation diverges from the partial text the gate
 * opens permanently and later deltas pass through untouched.
 */
export function overlapGate(
  produced: string,
  options: {
    minOverlap?: number;
    lookahead?: number;
    scanLimit?: number;
  } = {}
): { push: (delta: string) => string; flush: () => string } {
  const minOverlap = options.minOverlap ?? MIN_OVERLAP_CHARS;
  const lookahead = options.lookahead ?? LOOKAHEAD_CHARS;
  const scanLimit = options.scanLimit ?? OVERLAP_SCAN_CHARS;

  let buffered = "";
  // Nothing was produced, so there is nothing that could be repeated.
  let open = produced.length === 0;

  const scan = Math.min(produced.length, scanLimit);

  const decide = (): string => {
    // The whole answer was replayed from the top: everything up to the end of
    // the partial text is a duplicate, and the rest is new.
    if (buffered.startsWith(produced)) {
      const fresh = buffered.slice(produced.length);
      buffered = "";
      open = true;
      return fresh;
    }

    // Still inside a replay of the top. Wait for the divergence, unless the
    // scan window is exhausted and waiting longer would only delay the stream.
    if (produced.startsWith(buffered)) {
      if (buffered.length < scan) return "";
      buffered = "";
      open = true;
      return "";
    }

    // A repeat of the tail, as long as it is long enough to be a replay.
    let overlap = 0;
    const ceiling = Math.min(scan, buffered.length);

    for (let size = ceiling; size >= minOverlap; size -= 1) {
      if (produced.endsWith(buffered.slice(0, size))) {
        overlap = size;
        break;
      }
    }

    const fresh = buffered.slice(overlap);
    buffered = "";
    open = true;
    return fresh;
  };

  return {
    push(delta: string): string {
      if (open) return delta;

      buffered += delta;
      if (buffered.length < lookahead) return "";

      return decide();
    },

    flush(): string {
      if (open) return "";
      return decide();
    },
  };
}
