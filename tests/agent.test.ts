import { randomBytes } from "node:crypto";

import { expect, test } from "bun:test";

import {
  CONTINUE_AT_MS,
  MAX_STEPS,
  MAX_TURN_TOKENS,
  TURN_TTL_MS,
  hashPrompt,
  signEnvelope,
  verifyEnvelope,
} from "../lib/agent/envelope";

/**
 * The signed continuation envelope.
 *
 * The tool cases that used to live here tested `lib/agent/tools.ts`, the
 * read-only GitHub tool set of the retired agent loop. That module is gone; the
 * tool surface that runs is `lib/runs/tools.ts`, covered by `runs.test.ts` and
 * held to its prompt by `run-prompt.test.ts`.
 */

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
  expect(MAX_STEPS).toBe(40);
  expect(MAX_TURN_TOKENS).toBe(2_000_000);
  expect(TURN_TTL_MS).toBe(1_800_000);
  expect(CONTINUE_AT_MS).toBeLessThan(60_000);
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
