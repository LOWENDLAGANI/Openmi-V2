import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { sandboxTurnsEnabled } from "../lib/env";
import {
  GITHUB_ONLY_CLAUSE,
  NO_READ_CLAUSE,
  SHELL_CLAUSE,
  buildSystemPrompt,
} from "../lib/prompt";

const ROUTE = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);

test("a chat turn gets the sandbox unless the operator turns it off", () => {
  expect(sandboxTurnsEnabled({})).toBe(true);
  // A blank line in an env file is not an instruction.
  expect(sandboxTurnsEnabled({ OPENMI_SANDBOX_TURNS: "" })).toBe(true);

  for (const on of ["on", "TRUE", "1", "yes"]) {
    expect(sandboxTurnsEnabled({ OPENMI_SANDBOX_TURNS: on })).toBe(true);
  }

  for (const off of ["off", "0", "no", "false"]) {
    expect(sandboxTurnsEnabled({ OPENMI_SANDBOX_TURNS: off })).toBe(false);
  }
});

test("the route refuses before it queues when there is no execution provider", () => {
  // A chat turn is a run, and a run always owns a sandbox. The refusal names
  // the missing configuration instead of queueing work that can only fail.
  expect(ROUTE).toContain("executionConfigured()");
  expect(ROUTE.indexOf("executionConfigured()")).toBeLessThan(
    ROUTE.indexOf("createRun(")
  );

  // The in-request shell is gone: the worker opens the workspace, not the route.
  expect(ROUTE).not.toContain("createShellTurn");
});

test("a turn whose repository could not be opened is not told it has read tools", () => {
  const prompt = buildSystemPrompt({
    repo: "octocat/hello",
    sha: "abc123",
    context: "",
    notes: [],
    shell: false,
    readTools: false,
  });

  // The fallback path offers no tools, so the prompt may not promise any.
  expect(prompt).toContain(NO_READ_CLAUSE);
  expect(prompt).not.toContain(GITHUB_ONLY_CLAUSE);
  expect(prompt).not.toContain("propose_edits");
});

test("a GitHub-only turn is not told it has a terminal", () => {
  const prompt = buildSystemPrompt({
    repo: "octocat/hello",
    sha: "abc123",
    context: "### src/app.ts\n\nexport const app = 1;",
    notes: [],
    shell: false,
  });

  expect(prompt).toContain(GITHUB_ONLY_CLAUSE);
  expect(prompt).not.toContain(SHELL_CLAUSE);
  expect(prompt).not.toContain("run_command");
  expect(prompt).toContain("propose_edits");
});
