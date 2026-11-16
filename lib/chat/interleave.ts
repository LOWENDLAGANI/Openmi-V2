import type { AgentStep } from "@/lib/types";

/**
 * The answer split into the stretches of text that ran between steps.
 *
 * A turn is not a console followed by an answer. The model narrates what it is
 * about to do, does it, reads the result, and carries on — so the work belongs
 * between the sentences that surround it. Each segment is the text that came
 * before the steps hanging off it.
 */
export type AnswerSegment = {
  /** The answer text written before `steps` happened. */
  text: string;
  /** The steps recorded at this point in the text, in the order they ran. */
  steps: AgentStep[];
};

/** Where a step sits in the answer, or the top when the row does not say. */
function offsetOf(step: AgentStep): number {
  return typeof step.at === "number" && Number.isFinite(step.at)
    ? Math.max(0, step.at)
    : 0;
}

/**
 * Whether `index` falls inside a fenced code block.
 *
 * Splitting a fence in two would turn the half after the cut into prose, so a
 * cut is only taken where the fence count before it is even.
 */
function insideFence(content: string, index: number): boolean {
  return content.slice(0, index).split("```").length % 2 === 0;
}

/**
 * The end of the last paragraph that finishes at or before `index`.
 *
 * A paragraph break is the one place a markdown document can be cut without
 * changing what either half means. When there is no break to cut at, the step
 * stays at the top rather than being dropped into the middle of a sentence.
 */
function paragraphCut(content: string, index: number): number {
  let cut = index;

  while (cut > 0) {
    const breakAt = content.lastIndexOf("\n\n", cut - 1);
    if (breakAt === -1) return 0;
    // The cut lands after the blank line, so neither half carries a stray gap.
    if (!insideFence(content, breakAt)) return breakAt + 2;
    cut = breakAt;
  }

  return 0;
}

/**
 * Put each step where it happened in `content`.
 *
 * Offsets are snapped to paragraph breaks, clamped into the text, and kept in
 * order: a step whose offset is behind the one before it joins that step's
 * group instead of appearing to have happened twice. Segments always alternate
 * text-then-steps and the last one is text, so a caller can render them in
 * order and get the transcript back.
 */
export function interleaveAnswer(
  content: string,
  steps?: AgentStep[] | null
): AnswerSegment[] {
  const list = steps ?? [];
  if (list.length === 0) return [{ text: content, steps: [] }];

  const segments: AnswerSegment[] = [];
  let cursor = 0;

  for (const step of list) {
    const raw = Math.min(offsetOf(step), content.length);
    const cut = Math.max(cursor, paragraphCut(content, raw));

    if (cut > cursor) {
      segments.push({ text: content.slice(cursor, cut), steps: [] });
      cursor = cut;
    } else if (segments.length === 0) {
      segments.push({ text: "", steps: [] });
    }

    segments[segments.length - 1].steps.push(step);
  }

  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), steps: [] });
  }

  return segments;
}
