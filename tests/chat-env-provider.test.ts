import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The provider is `server-only`, so these are contract tests over its source,
 * in the same style `tests/execution.test.ts` uses for the egress allowlist.
 *
 * The decisions they pin are the ones that would be silent if they regressed:
 * a chat box that killed itself at its deadline would lose its disk on the first
 * idle park, and a box that auto-resumed when it should not would outlive the run
 * that owns it.
 *
 * These moved with the provider when it went from Daytona to orkestr. The
 * product decisions are unchanged; the vocabulary they are expressed in is not.
 * Daytona had `ephemeral` and `autoStopInterval`/`autoDeleteInterval`; orkestr
 * has `onTimeout` and `autoResume`, and its own pause/resume is the stop/start.
 */

const provider = readFileSync(
  new URL("../lib/execution/provider.ts", import.meta.url),
  "utf8"
);

function bodyOf(start: string, end: string): string {
  const from = provider.indexOf(start);
  const to = provider.indexOf(end, from + start.length);

  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);

  return provider.slice(from, to);
}

const chatFactory = () =>
  bodyOf(
    "export async function createChatSandbox",
    "export async function attachSandbox"
  );

const ephemeralFactory = () =>
  bodyOf("export async function createSandbox", "export type ChatSandboxOptions");

test("a chat environment parks at its deadline instead of dying", () => {
  const chat = chatFactory();

  // `onTimeout: "pause"` snapshots and releases compute, so installed packages
  // and uncommitted files are still there when the chat wakes up.
  expect(chat).toContain('onTimeout: "pause"');
  expect(chat).not.toContain('onTimeout: "kill"');
});

test("verification and mission boxes keep their one-run semantics", () => {
  const ephemeral = ephemeralFactory();

  expect(ephemeral).toContain('onTimeout: "kill"');
  expect(ephemeral).toContain("autoResume: false");
  expect(ephemeral).not.toContain('onTimeout: "pause"');
});

test("the chat factory is chosen by name, never by forgetting a flag", () => {
  const ephemeral = ephemeralFactory();

  // A `persistent?: boolean` on the old factory would let a caller create the
  // wrong kind of box by omission; two factories make the choice explicit.
  expect(ephemeral).not.toContain("persistent");
  expect(chatFactory()).toContain("metadata:");
  expect(chatFactory()).toContain('kind: "chat"');
});

test("the provider gets the backstops a persistent box needs", () => {
  const chat = chatFactory();

  // A parked box wakes on its own next command, so a message that arrives after
  // a night of silence does not have to know it was parked.
  expect(chat).toContain("autoResume: true");
  expect(chat).toContain("timeoutSeconds");
  expect(chat).toContain("boundedTimeoutSeconds(ttl * 60)");

  // A key without a card caps a box at 30 minutes, so the create is retried once
  // at the ceiling every tier accepts rather than failing chat workspaces on a
  // fresh account.
  expect(chat).toContain("EXEC_FREE_TIER_TIMEOUT_SECONDS");
});

test("archive is not sent, because the provider has no archive tier", () => {
  const chat = chatFactory();

  expect(chat).not.toContain("autoArchiveInterval");
  expect(chat).not.toContain("autoDeleteInterval");
  expect(chat).not.toContain("autoStopInterval");
});

test("the handle can start, stop, refresh TTL and read a live state", () => {
  const handle = bodyOf("function handleFor", "export async function createSandbox");

  expect(handle).toContain("state()");
  expect(handle).toContain("current.refresh()");
  expect(handle).toContain("start(");
  expect(handle).toContain("Sandbox.resume(");
  expect(handle).toContain("stop(");
  expect(handle).toContain("current.pause()");
  expect(handle).toContain("setTtl(minutes)");
  expect(handle).toContain("setTimeout(");

  // Stop must not be turned into a delete: the disk is the point.
  const stop = handle.slice(handle.indexOf("async stop("), handle.indexOf("async setTtl("));
  expect(stop).not.toContain("terminate(");
});

test("a missing box is recoverable, and only an attach may say so", () => {
  expect(provider).toContain('SandboxStartError("missing"');
  expect(provider).toContain('context === "attach"');
  expect(provider).toContain("SandboxNotFound");
  expect(provider).toContain('classifyStartError(caught, "attach")');
  expect(provider).toContain('classifyStartError(caught, "create")');
});

test("unknown provider states are not mistaken for a wipeable box", () => {
  const normalise = bodyOf("function normalizeState", "export type SandboxHandle");

  expect(normalise).toContain('return "unknown"');
  expect(normalise).toContain('case "starting"');
  expect(normalise).toContain('case "paused"');
  expect(normalise).toContain('case "terminated"');
});

test("a workspace-relative path reaches the file API absolute", () => {
  // The callers above name paths the way a shell sees them; the file API only
  // writes under /workspace. One adapter, not a rewrite of every caller.
  expect(provider).toContain("function absolutePath(");
  expect(provider).toContain('const WORKSPACE_ROOT = "/workspace"');
  expect(provider).toContain("absolutePath(cwd ?? EXEC_WORKDIR)");
  expect(provider).toContain("absolutePath(remotePath)");
});
