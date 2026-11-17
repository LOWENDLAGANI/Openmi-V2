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
