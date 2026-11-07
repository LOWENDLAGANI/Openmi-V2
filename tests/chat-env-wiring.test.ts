import { expect, test } from "bun:test";

import { readFileSync } from "node:fs";

import { buildSystemPrompt } from "../lib/prompt";

/**
 * The turn-side contract for chat environments.
 *
 * The resolver is tested directly; what these assert is that the turn actually
 * calls it, that the old per-message path survives only behind the kill
 * switch, and that ending a turn releases a workspace instead of deleting it.
 */

const sandbox = readFileSync("lib/agent/sandbox.ts", "utf8");
const route = readFileSync("app/api/chat/route.ts", "utf8");

function at(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle);
  expect(index).toBeGreaterThan(-1);
  return index;
}

test("a chat turn opens the chat's environment, not a new box", () => {
  const ensure = sandbox.slice(at(sandbox, "async function ensure("), at(sandbox, "async function execDetailed("));

  expect(ensure).toContain("openChatSandbox");
  expect(sandbox).toContain("chatSandboxesEnabled");
  expect(at(ensure, "if (persistent)")).toBeLessThan(at(ensure, "createSandbox("));
});

test("ending a persistent turn releases the lease and never destroys the disk", () => {
  const close = sandbox.slice(at(sandbox, "async close()"));

  expect(close).toContain("releaseChatSandbox");
  expect(at(close, "if (persistent && chatRow)")).toBeLessThan(at(close, "handle.destroy()"));
  expect(at(close, "releaseChatSandbox")).toBeLessThan(at(close, "handle.destroy()"));
});

test("the route passes the session owner and lets a paused workspace continue", () => {
  expect(route).toContain("owner: session.user.id");
  expect(route).toContain("chatId,");
  expect(route).toContain("onNotice:");
  expect(route).toContain("retainsWorkspace()");
  expect(route).toContain('const pausable = result.stopped === "paused" && (!shellTurn || retainedWorkspace)');

  // The old rule refused every paused shell turn. It must be gone, not merely
  // shadowed by a second declaration.
  expect(route).not.toContain('const pausable = result.stopped === "paused" && !shellTurn');
});

test("only a persistent workspace is described to the model as persistent", () => {
  const base = {
    repo: "openmi/v2",
    sha: "a".repeat(40),
    context: "",
    notes: [],
  };

  const persistent = buildSystemPrompt({ ...base, shell: true, persistentShell: true });
  const perMessage = buildSystemPrompt({ ...base, shell: true });

  expect(persistent).toContain("persists between messages");
  // A background process is part of what persists now, so the prompt promises
  // exactly that and tells the model how to stop it.
  expect(persistent).toContain("keeps running too");
  expect(persistent).toContain("kill_process");
  expect(perMessage).not.toContain("persists between messages");
  expect(perMessage).toContain("destroyed when the answer ends");
});
