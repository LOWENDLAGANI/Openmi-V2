import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { parseSealKey } from "../crypto";

/**
 * The turn envelope, and the caps it carries.
 *
 * The token is unsigned-by-construction nowhere: it is an HMAC over a small
 * payload, so the server can issue a continuation and later prove it issued it.
 * It is deliberately NOT the authority on how many steps remain — the
 * `agent_turns` row is, via compare-and-set. A token that only *claims* a step
 * count is a token an attacker can mint a fresh copy of.
 *
 * The key is derived from GITHUB_TOKEN_KEY with a label rather than sharing it
 * directly. Same key material, different purpose, no new secret to configure.
 */

export const MAX_STEPS = 40;
export const MAX_TURN_TOKENS = 120_000;
export const TURN_TTL_MS = 30 * 60 * 1000;
/** Leave room inside the function's 60s ceiling to write the answer down. */
export const CONTINUE_AT_MS = 40_000;

export type TurnPayload = {
  v: 1;
  turnId: string;
  chatId: string;
  model: string;
  promptHash: string;
  steps: number;
  exp: number;
};

export type VerifyResult =
  | { ok: true; payload: TurnPayload }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

function signingKey(base64Key: string): Buffer {
  return createHmac("sha256", parseSealKey(base64Key))
    .update("openmi:turn-envelope:v1")
    .digest();
}

function sign(payloadBase64: string, base64Key: string): string {
  return createHmac("sha256", signingKey(base64Key))
    .update(payloadBase64)
    .digest("base64url");
}

export function hashPrompt(text: string): string {
  return createHmac("sha256", "openmi:prompt-hash")
    .update(text)
    .digest("hex")
    .slice(0, 32);
}

export function newTurnId(): string {
  return randomUUID();
}

export function signEnvelope(
  payload: Omit<TurnPayload, "v">,
  base64Key: string
): string {
  const encoded = Buffer.from(
    JSON.stringify({ v: 1, ...payload } satisfies TurnPayload),
    "utf8"
  ).toString("base64url");

  return `${encoded}.${sign(encoded, base64Key)}`;
}

export function verifyEnvelope(
  token: string,
  base64Key: string,
  now: number = Date.now()
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0].length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const [encoded, signature] = parts;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(sign(encoded, base64Key), "base64url");
    actual = Buffer.from(signature, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "signature" };
  }

  let payload: TurnPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TurnPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    payload.v !== 1 ||
    typeof payload.turnId !== "string" ||
    typeof payload.chatId !== "string" ||
    typeof payload.steps !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (payload.exp < now) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}
