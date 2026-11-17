import { expect, test } from "bun:test";

import {
  MAX_CONTEXT_CHARS,
  MAX_TREE_PATHS,
  assembleContext,
} from "../lib/context";

/**
 * The context budget, on its own.
 *
 * These cases used to share a file with the retired GitHub-only prompt, which
 * made a passing suite read as though that prompt had been exercised. What is
 * left is the budget: the pinned file survives, the tree is capped, and a trim
 * says so instead of going quiet.
 */

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
