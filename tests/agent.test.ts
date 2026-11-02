import { randomBytes } from "node:crypto";

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  CONTINUE_AT_MS,
  MAX_STEPS,
  MAX_TURN_TOKENS,
  TURN_TTL_MS,
  hashPrompt,
  signEnvelope,
  verifyEnvelope,
} from "../lib/agent/envelope";
import {
  MAX_LIST_FILES,
  MAX_READ_FILE_BYTES,
  MAX_SEARCH_CANDIDATES,
  TOOL_SPECS,
  parseArguments,
  runTool,
} from "../lib/agent/tools";

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");

function payload(overrides: Partial<Parameters<typeof signEnvelope>[0]> = {}) {
  return {
    turnId: "turn-1",
    chatId: "chat-1",
    model: "auto",
    promptHash: hashPrompt("hello"),
    steps: 3,
    exp: Date.now() + TURN_TTL_MS,
    ...overrides,
  };
}

test("the documented caps are the exported constants", () => {
  expect(MAX_STEPS).toBe(24);
  expect(MAX_TURN_TOKENS).toBe(120_000);
  expect(TURN_TTL_MS).toBe(1_800_000);
  expect(CONTINUE_AT_MS).toBeLessThan(60_000);
  expect(MAX_LIST_FILES).toBe(200);
  expect(MAX_READ_FILE_BYTES).toBe(200_000);
  expect(MAX_SEARCH_CANDIDATES).toBe(10);
});

test("an envelope round-trips with its step count", () => {
  const token = signEnvelope(payload(), KEY);
  const result = verifyEnvelope(token, KEY);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.payload.turnId).toBe("turn-1");
  expect(result.payload.steps).toBe(3);
});

test("a tampered envelope is refused", () => {
  const token = signEnvelope(payload(), KEY);
  const [encoded, signature] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(encoded, "base64url").toString()), steps: 0 })
  ).toString("base64url");

  const result = verifyEnvelope(`${forged}.${signature}`, KEY);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("signature");
});

test("another deployment key cannot verify it", () => {
  const result = verifyEnvelope(signEnvelope(payload(), KEY), OTHER_KEY);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("signature");
});

test("an expired envelope is refused", () => {
  const token = signEnvelope(payload({ exp: Date.now() - 1 }), KEY);
  const result = verifyEnvelope(token, KEY);

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe("expired");
});

test("the prompt hash is stable and does not contain the prompt", () => {
  const hash = hashPrompt("where is the router");
  expect(hash).toBe(hashPrompt("where is the router"));
  expect(hash).not.toContain("router");
  expect(hash).toHaveLength(32);
});

test("no tool accepts a url", () => {
  for (const tool of TOOL_SPECS) {
    const schema = JSON.stringify(tool.parameters).toLowerCase();
    expect(schema).not.toContain("\"url\"");
    expect(schema).not.toContain("http");
    expect(tool.description.toLowerCase()).not.toContain("url");
  }
});

test("the tool module makes no requests of its own", () => {
  const source = readFileSync(new URL("../lib/agent/tools.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/\bfetch\(/);
  expect(source).not.toMatch(/method:/);
});

test("tool arguments are validated before any read", async () => {
  const context = { token: "unused", fullName: "octocat/hello", sha: "abc1234", paths: ["a.ts"] };

  const traversal = await runTool("read_file", { path: "../secrets" }, context);
  expect(traversal.ok).toBe(false);

  const extraKey = await runTool("read_file", { path: "a.ts", url: "http://169.254.169.254" }, context);
  expect(extraKey.ok).toBe(false);

  const notObject = await runTool("list_files", null, context);
  expect(notObject.ok).toBe(false);

  const unknown = await runTool("shell", {}, context);
  expect(unknown.ok).toBe(false);

  const shortQuery = await runTool("search_code", { query: "a" }, context);
  expect(shortQuery.ok).toBe(false);
});

test("list_files caps and reports honestly without a network call", async () => {
  const paths = Array.from({ length: MAX_LIST_FILES + 25 }, (_, index) => `src/f-${index}.ts`);
  const result = await runTool("list_files", {}, {
    token: "unused",
    fullName: "octocat/hello",
    sha: "abc1234",
    paths,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.text).toContain(`at most ${MAX_LIST_FILES}`);
  expect(result.text).toContain("src/f-0.ts");
  expect(result.text).not.toContain(`src/f-${MAX_LIST_FILES + 1}.ts`);
});

test("arguments that are not JSON are refused rather than guessed", () => {
  expect(parseArguments("not json")).toBeNull();
  expect(parseArguments("[1,2]")).toBeNull();
  expect(parseArguments("")).toEqual({});
  expect(parseArguments('{"path":"a.ts"}')).toEqual({ path: "a.ts" });
});
