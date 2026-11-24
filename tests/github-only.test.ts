import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { sandboxTurnsEnabled } from "../lib/env";

/**
 * Every chat turn is a run, and the route refuses before it queues.
 *
 * The prompt clauses this file used to exercise belonged to the GitHub-only
 * composer that no route sent; they are gone, and the rules that still hold now
 * live in `lib/runs/prompt.ts`, pinned by `tests/run-prompt.test.ts`.
 */

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

test("the chat route queues runs even without an execution provider configured", () => {
  // Runs degrade gracefully to sandboxless mode when E2B_API_KEY is absent or
  // fails to start, so the chat route does not refuse on executionConfigured().
  expect(ROUTE).not.toContain("executionConfigured()");

  // The in-request shell is gone: the worker opens the workspace, not the route.
  expect(ROUTE).not.toContain("createShellTurn");
});
