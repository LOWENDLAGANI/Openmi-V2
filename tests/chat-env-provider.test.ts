import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The provider is `server-only`, so these are contract tests over its source,
 * in the same style `tests/execution.test.ts` uses for the egress allowlist.
 *
 * The decisions they pin are the ones that would be silent if they regressed:
 * a chat box that became ephemeral would lose its disk on the first idle stop,
 * and a zero archive interval would keep that disk for thirty days.
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
  bodyOf(
    "export async function createSandbox",
    "export async function createChatSandbox"
  );

test("a chat environment is not ephemeral, because ephemeral deletes on stop", () => {
  const chat = chatFactory();

  expect(chat).toContain("ephemeral: false");
  expect(chat).not.toContain("ephemeral: true");
});

test("verification and mission boxes keep their one-run semantics", () => {
  const ephemeral = ephemeralFactory();

  expect(ephemeral).toContain("ephemeral: true");
  expect(ephemeral).toContain("autoStopInterval");
  expect(ephemeral).not.toContain("ephemeral: false");
});

test("the chat factory is chosen by name, never by forgetting a flag", () => {
  const ephemeral = ephemeralFactory();

  // A `persistent?: boolean` on the old factory would let a caller create the
  // wrong kind of box by omission; two factories make the choice explicit.
  expect(ephemeral).not.toContain("persistent");
  expect(chatFactory()).toContain("labels:");
  expect(chatFactory()).toContain('kind: "chat"');
});

test("the provider gets all three backstops a persistent box needs", () => {
  const chat = chatFactory();

  expect(chat).toContain("autoStopInterval: idle");
  expect(chat).toContain("autoDeleteInterval: autoDelete");
  expect(chat).toContain("ttlMinutes: ttl");
});

test("archive is sent only when asked, because zero means thirty days", () => {
  const chat = chatFactory();

  expect(chat).toContain("archive > 0 ? { autoArchiveInterval: archive }");
});

test("the handle can start, stop, refresh TTL and read a live state", () => {
  const handle = bodyOf("function handleFor", "export async function createSandbox");

  expect(handle).toContain("state()");
  expect(handle).toContain("refreshData()");
  expect(handle).toContain("start(timeoutSeconds");
  expect(handle).toContain("sandbox.start(");
  expect(handle).toContain("stop(options");
  expect(handle).toContain("sandbox.stop(");
  expect(handle).toContain("setTtl(minutes)");
  expect(handle).toContain("sandbox.setTtl(");

  // Stop must not be turned into a delete: the disk is the point.
  const stop = handle.slice(handle.indexOf("async stop("), handle.indexOf("async setTtl("));
  expect(stop).not.toContain("delete(");
});

test("a missing box is recoverable, and only an attach may say so", () => {
  expect(provider).toContain('SandboxStartError("missing"');
  expect(provider).toContain('context === "attach"');
  expect(provider).toContain('status === 404');
  expect(provider).toContain('classifyStartError(caught, "attach")');
  expect(provider).toContain('classifyStartError(caught, "create")');
});

test("unknown provider states are not mistaken for a wipeable box", () => {
  const normalise = bodyOf("function normalizeState", "export type SandboxHandle");

  expect(normalise).toContain('return "unknown"');
  expect(normalise).toContain('case "creating"');
  expect(normalise).toContain('case "stopped"');
  expect(normalise).toContain('case "archived"');
});
