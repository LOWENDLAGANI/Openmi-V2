/**
 * Reading a request before Auto chooses a model.
 *
 * This is a deterministic read of the prompt, not a model call: a classifier
 * that needs a model call to decide which model to call is a second failure
 * point in front of the first. Every signal is weighted and the highest score
 * wins; a tie is `general`, which is the honest answer when nothing stands out.
 */

import type { TaskKind } from "../models/registry";

type Signal = { pattern: RegExp; weight: number };

const CODE_SIGNALS: Signal[] = [
  { pattern: /```/, weight: 3 },
  { pattern: /\b(function|class|const|let|var|import|export|return|interface|type)\b/, weight: 2 },
  { pattern: /\b(bug|fix|refactor|compile|stack ?trace|exception|typescript|javascript|python|sql|database|endpoint|api|regex|unit test|integration test|diff|commit|pull request|merge conflict)\b/, weight: 3 },
  { pattern: /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|sql|json|css|scss|html|yml|yaml|toml)\b/i, weight: 2 },
  { pattern: /\b(npm|bun|pnpm|node_modules|segfault|null pointer|500 error|404)\b/, weight: 2 },
];

const REASONING_SIGNALS: Signal[] = [
  { pattern: /\b(why|prove|reason|reasoning|derive|trade-?off|compare|contrast|analyse|analyze|evaluate|architecture|strategy|design)\b/, weight: 3 },
  { pattern: /\bstep by step\b/, weight: 2 },
  { pattern: /\b(is it (true|possible|worth)|should (i|we)|what if|implications|root cause)\b/, weight: 2 },
  { pattern: /\b(explain|assume|suppose|therefore|counterexample)\b/, weight: 1 },
];

const SEARCH_SIGNALS: Signal[] = [
  { pattern: /\b(latest|newest|today|tonight|yesterday|current|currently|recent|news|release|changelog|roadmap|price|pricing|weather|stock)\b/, weight: 3 },
  { pattern: /\b(search|look up|google|browse|fetch|find online|official site|documentation for)\b/, weight: 3 },
  { pattern: /\b(as of|this (year|month|week)|20\d\d)\b/, weight: 1 },
];

const AGENT_SIGNALS: Signal[] = [
  { pattern: /\b(open (the |a )?(page|url|site|website)|click|fill (in|out)|type into|submit (the )?form|log ?in|sign ?in|screenshot|navigate)\b/, weight: 3 },
  { pattern: /\b(browser|headless|playwright|puppeteer|computer use|automate the page|local dev server)\b/, weight: 3 },
  { pattern: /\bhttps?:\/\/\S+/, weight: 1 },
];

function score(text: string, signals: Signal[]): number {
  return signals.reduce(
    (total, signal) => (signal.pattern.test(text) ? total + signal.weight : total),
    0
  );
}

/**
 * Which kind of request this is.
 *
 * An attached image settles it: no text heuristic can outvote a picture, and a
 * model that cannot read one cannot answer. Everything else is scored, and a tie
 * falls to `general`.
 */
export function classifyTask(
  prompt: string,
  options: { images?: boolean; documents?: boolean } = {}
): TaskKind {
  if (options.images) return "vision";

  const text = prompt.toLowerCase();
  if (text.trim().length === 0) return "general";

  const scores: Array<{ kind: TaskKind; score: number }> = [
    { kind: "coding", score: score(text, CODE_SIGNALS) },
    { kind: "reasoning", score: score(text, REASONING_SIGNALS) },
    { kind: "search", score: score(text, SEARCH_SIGNALS) },
    { kind: "agent", score: score(text, AGENT_SIGNALS) },
  ];

  let best = scores[0]!;

  for (const entry of scores) {
    if (entry.score > best.score) best = entry;
  }

  // Nothing matched: a plain question is a general one, not a guess.
  return best.score > 0 ? best.kind : "general";
}
