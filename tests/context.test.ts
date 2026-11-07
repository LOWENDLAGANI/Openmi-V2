import { expect, test } from "bun:test";

import {
  MAX_CONTEXT_CHARS,
  MAX_TREE_PATHS,
  assembleContext,
} from "../lib/context";
import {
  ANALYSIS_CLAUSE,
  SHELL_CLAUSE,
  buildSystemPrompt,
} from "../lib/prompt";

const paths = Array.from({ length: 50 }, (_, index) => `src/module-${index}.ts`);

test("a continued turn is told it still has its sandbox", () => {
  const withShell = buildSystemPrompt({
    repo: "octocat/hello",
    sha: "abc123",
    context: "",
    notes: [],
    shell: true,
    continuation: true,
  });

  expect(withShell).toContain("continues a turn");
  expect(withShell).toContain("still have this chat's Linux sandbox");

  const withoutShell = buildSystemPrompt({
    repo: "octocat/hello",
    sha: "abc123",
    context: "",
    notes: [],
    shell: false,
    continuation: true,
  });

  expect(withoutShell).toContain("no sandbox in this turn");
  // The environment is stated once, and only the true one.
  expect(withShell).not.toContain("no sandbox in this turn");
});

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

test("the default prompt carries the shell and citation clauses", () => {
  const prompt = buildSystemPrompt({
    repo: "octocat/hello",
    sha: "abc1234",
    context: "### src/app.ts\n\nexport const app = 1;",
    notes: [],
  });

  expect(prompt).toContain(SHELL_CLAUSE);
  expect(prompt).toContain("path:line");
  expect(prompt).toContain("octocat/hello");
  expect(prompt).toContain("abc1234");
});

test("the default prompt still proposes shell execution when shell is unset", () => {
  const prompt = buildSystemPrompt({
    repo: "octocat/hello",
    sha: "abc1234",
    context: "",
    notes: [],
  });

  expect(prompt).toContain(SHELL_CLAUSE);
  expect(prompt).toContain("run_command");
  expect(prompt).toContain("curl, wget, npm, python");
  expect(prompt).toContain("output the command results");
});

test("analysis is code- and terminal-only, with no browser path", () => {
  const base = {
    repo: "octocat/hello",
    sha: "abc1234",
    context: "",
    notes: [],
  };
  const shell = buildSystemPrompt({ ...base, shell: true });
  const noShell = buildSystemPrompt({ ...base, shell: false });

  for (const prompt of [shell, noShell]) {
    expect(prompt).toContain(ANALYSIS_CLAUSE);
    expect(prompt).toContain("Do not open a browser");
    expect(prompt).not.toContain("headless Chromium with Playwright is available");
  }
});

test("the system prompt still refuses to pretend when no repository is attached", () => {
  const prompt = buildSystemPrompt({ repo: null, sha: null, context: "", notes: [] });

  expect(prompt).toContain("No repository is attached");
  expect(prompt).not.toContain("The attached repository is");
  expect(prompt).toContain(SHELL_CLAUSE);
});
