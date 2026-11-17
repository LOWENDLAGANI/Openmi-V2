/**
 * Thinking effort: how hard the model is asked to think before it answers.
 *
 * DeepSeek's V4.1 flash is the one model here that exposes this. Its thinking
 * mode is on by default at `high`, and the Chat Completions API names the level
 * with `reasoning_effort` — `none`, `low`, `high` or `max`, where `none` turns
 * thinking off. The levels this product offers are the three that matter to a
 * reader:
 *
 *   fast  — no thinking at all, so the answer starts at once;
 *   high  — the provider's own default, a model that deliberates;
 *   max   — the deepest setting, for the questions that deserve the wait.
 *
 * `fast` is the only one that turns thinking off. On a thinking model that is a
 * real difference in latency, not a label: with thinking on, the chain of
 * thought is written and billed before the first word of the answer.
 *
 * This module is pure and carries no key, endpoint or upstream id, so the picker
 * and the worker read the same definitions.
 */

export type ReasoningEffort = "fast" | "high" | "max";

export const REASONING_EFFORTS: {
  id: ReasoningEffort;
  label: string;
  blurb: string;
}[] = [
  {
    id: "fast",
    label: "Fast",
    blurb: "Answers without deliberating first. Quickest, with no reasoning to read.",
  },
  {
    id: "high",
    label: "High",
    blurb: "DeepSeek's default: it thinks before it answers.",
  },
  {
    id: "max",
    label: "Max",
    blurb: "The deepest setting, for the hardest questions. Slowest.",
  },
];

/**
 * The provider's default, used when the picker says nothing.
 *
 * It is DeepSeek's own default rather than a choice invented here: a reader who
 * never touches the control gets exactly what the model would have done on its
 * own.
 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    typeof value === "string" &&
    REASONING_EFFORTS.some((effort) => effort.id === value)
  );
}

/**
 * The effort a request asked for, or the default.
 *
 * Anything unrecognised falls back rather than being forwarded: an unknown level
 * is a provider 400, and a turn that fails because of a control the reader never
 * saw is worse than a turn at the default.
 */
export function effortOrDefault(value: unknown): ReasoningEffort {
  return isReasoningEffort(value) ? value : DEFAULT_REASONING_EFFORT;
}

/**
 * The models whose provider accepts an effort setting.
 *
 * One entry, because one catalogue model is served by a provider that documents
 * it. A model absent from this list is never sent the field: a vendor that does
 * not define it may reject the request, and a rejected request is a failed turn.
 */
export const EFFORT_MODELS: readonly string[] = ["deepseek-flash"];

export function modelSupportsEffort(id: string): boolean {
  return EFFORT_MODELS.includes(id);
}

/**
 * The request field for one effort, exactly as DeepSeek documents it.
 *
 * One field, not two: `reasoning_effort` both names the level and doubles as the
 * toggle, since `none` switches thinking off. DeepSeek's separate `thinking`
 * object would do the same job, but it is vendor-private — a proxy that validates
 * OpenAI-compatible bodies may reject it, and a rejected request is a failed
 * turn. `reasoning_effort` is the field the Chat Completions API itself defines.
 */
export function reasoningRequest(
  effort: ReasoningEffort
): Record<string, unknown> {
  return { reasoning_effort: effort === "fast" ? "none" : effort };
}
