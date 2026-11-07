import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { sandboxTurnsEnabled } from "../lib/env";
import {
  GITHUB_ONLY_CLAUSE,
  SHELL_CLAUSE,
  buildSystemPrompt,
} from "../lib/prompt";

const ROUTE = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);

test("a chat turn is GitHub-only unless the operator gives the sandbox back", () => {
  expect(sandboxTurnsEnabled({})).toBe(false);

  for (const on of ["on", "TRUE", "1", "yes"]) {
    expect(sandboxTurnsEnabled({ OPENMI_SANDBOX_TURNS: on })).toBe(true);
  }

  for (const off of ["off", "0", "no", ""]) {
    expect(sandboxTurnsEnabled({ OPENMI_SANDBOX_TURNS: off })).toBe(false);
  }
});

test("the route asks the policy before it provisions a shell turn", () => {
  expect(ROUTE).toContain("sandboxTurnsEnabled()");
  expect(ROUTE.indexOf("createShellTurn(")).toBeGreaterThan(
    ROUTE.indexOf("sandboxTurnsEnabled()")
  );

  // The sandbox is moved aside, not deleted: pause, resume and release are wired.
  expect(ROUTE).toContain("await shellTurn?.close()");
  expect(ROUTE).toContain("retainsWorkspace()");
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
