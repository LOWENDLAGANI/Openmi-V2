import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import * as prompt from "../lib/prompt";

const ROUTE = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);
const SOURCE = readFileSync(
  new URL("../lib/prompt.ts", import.meta.url),
  "utf8"
);

/**
 * One composer, or the prompt drifts.
 *
 * `lib/prompt.ts` used to export a `SYSTEM_PROMPT` constant that nothing sent,
 * next to `buildSystemPrompt`, which everything sends. A static copy of the
 * contract is worse than no copy: it looks authoritative, it is never exercised,
 * and editing it changes nothing. These cases pin the surface so a second
 * builder has to be a deliberate act with a failing test in front of it.
 */
test("buildSystemPrompt is the only function that composes a prompt", () => {
  const functions = Object.entries(prompt)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name)
    .sort();

  // `continuationClause` returns one sentence for a resumed turn, not a system
  // prompt. Anything else appearing here is a second composer.
  expect(functions).toEqual(["buildSystemPrompt", "continuationClause"]);
});

test("the prompt is never a module-level constant", () => {
  const constants = Object.entries(prompt)
    .filter(([, value]) => typeof value === "string")
    .map(([name]) => name);

  // Clauses are fine; a whole assembled prompt is not, because a turn's prompt
  // depends on the shell, the continuation and the repository.
  expect(constants).not.toContain("SYSTEM_PROMPT");
  expect(constants.filter((name) => name.endsWith("_PROMPT"))).toEqual([]);
});

test("the sections are joined in exactly one place", () => {
  const joins = SOURCE.match(/\.join\("\\n\\n"\)/g) ?? [];

  // `buildSystemPrompt` returns `[...head, ...tail].join("\n\n")`. A second
  // join is how two prompts start disagreeing about the same clauses.
  expect(joins).toHaveLength(1);
});

test("the run loop builds its prompt through a builder, not a constant", () => {
  // Execution moved into the worker, and so did the prompt: the loop composes
  // from the workspace it opened, and keeps no fallback of its own.
  const LOOP = readFileSync(new URL("../lib/runs/loop.ts", import.meta.url), "utf8");

  expect(LOOP).toContain("buildRunSystemPrompt({");
  expect(LOOP).not.toMatch(/\bSYSTEM_PROMPT\b/);
  expect(ROUTE).not.toContain("buildSystemPrompt(");
});
