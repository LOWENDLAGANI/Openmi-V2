import { expect, test } from "bun:test";

import {
  MAX_CONTEXT_CHARS,
  MAX_TREE_PATHS,
  assembleContext,
} from "../lib/context";
import {
  NO_EXECUTION_CLAUSE,
  buildSystemPrompt,
} from "../lib/prompt";

const paths = Array.from({ length: 50 }, (_, index) => `src/module-${index}.ts`);

test("the open file is kept and the tree is added", () => {
  const budget = assembleContext({
    paths,
    pinned: { path: "src/app.ts", text: "export const app = 1;" },
  });

  expect(budget.text).toContain("src/app.ts");
  expect(budget.text).toContain("src/module-1.ts");
  expect(budget.usedChars).toBe(budget.text.length);
  expect(budget.budgetChars).toBe(MAX_CONTEXT_CHARS);
  expect(budget.pinnedIncluded).toBe(true);
});

test("a budget too small for the tree trims it and says so", () => {
  const budget = assembleContext({
    paths,
    pinned: null,
    budget: 260,
  });

  expect(budget.notes.join(" ")).toContain("trimmed");
  expect(budget.usedChars).toBeLessThanOrEqual(budget.budgetChars);
});

test("the open file survives a budget it cannot fit in, with a note", () => {
  const file = { path: "src/big.ts", text: "x".repeat(500) };

  const budget = assembleContext({ paths, pinned: file, budget: 200 });

  expect(budget.text).toContain("src/big.ts");
  expect(budget.pinnedIncluded).toBe(true);
  expect(budget.notes.join(" ")).toContain("larger than");
  expect(budget.text).not.toContain("src/module-1.ts");
});

test("an empty tree is reported rather than silently empty", () => {
  const budget = assembleContext({ paths: [], pinned: null });

  expect(budget.text).toBe("");
  expect(budget.notes).toHaveLength(1);
  expect(budget.notes[0]).toContain("No repository tree");
});

test("the path list is capped at the named constant", () => {
  const many = Array.from({ length: MAX_TREE_PATHS + 30 }, (_, index) => `p/${index}.ts`);
  const budget = assembleContext({ paths: many, pinned: null });

  expect(budget.notes.join(" ")).toContain(String(many.length));
});

test("the system prompt carries the no-execution and citation clauses", () => {
  const prompt = buildSystemPrompt({
    repo: "octocat/hello",
    sha: "abc1234",
    context: "### src/app.ts\n\nexport const app = 1;",
    notes: [],
  });

  expect(prompt).toContain(NO_EXECUTION_CLAUSE);
  expect(prompt).toContain("path:line");
  expect(prompt).toContain("octocat/hello");
  expect(prompt).toContain("abc1234");
});

test("the system prompt refuses to pretend when no repository is attached", () => {
  const prompt = buildSystemPrompt({ repo: null, sha: null, context: "", notes: [] });

  expect(prompt).toContain("No repository is attached");
  expect(prompt).not.toContain("The attached repository is");
});


