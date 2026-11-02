import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";

import { SEAL_KEY_BYTES, open, parseSealKey, seal, tailOf } from "../lib/crypto";

const KEY = randomBytes(SEAL_KEY_BYTES).toString("base64");
const OTHER_KEY = randomBytes(SEAL_KEY_BYTES).toString("base64");
const TOKEN = "ghp_exampleTokenValue1234";

function reseal(sealed: string, mutate: (parts: string[]) => void): string {
  const parts = sealed.split(".");
  mutate(parts);
  return parts.join(".");
}

test("a token round-trips and the ciphertext does not contain it", () => {
  const sealed = seal(TOKEN, KEY);

  expect(sealed.startsWith("v1.")).toBe(true);
  expect(sealed.split(".")).toHaveLength(4);
  expect(sealed).not.toContain(TOKEN);
  expect(sealed).not.toContain("ghp_");
  expect(open(sealed, KEY)).toBe(TOKEN);
});

test("the same token seals differently every time", () => {
  // A fixed nonce would leak equality between stores; GCM needs a fresh one.
  expect(seal(TOKEN, KEY)).not.toBe(seal(TOKEN, KEY));
});

test("a tampered tag is refused, not decrypted", () => {
  const sealed = seal(TOKEN, KEY);

  const tampered = reseal(sealed, (parts) => {
    const tag = Buffer.from(parts[2], "base64url");
    tag[0] ^= 0x01;
    parts[2] = tag.toString("base64url");
  });

  expect(() => open(tampered, KEY)).toThrow();
});

test("a tampered ciphertext is refused, not decrypted", () => {
  const sealed = seal(TOKEN, KEY);

  const tampered = reseal(sealed, (parts) => {
    const ciphertext = Buffer.from(parts[3], "base64url");
    ciphertext[ciphertext.length - 1] ^= 0x01;
    parts[3] = ciphertext.toString("base64url");
  });

  expect(() => open(tampered, KEY)).toThrow();
});

test("a different key cannot open it", () => {
  const sealed = seal(TOKEN, KEY);
  expect(() => open(sealed, OTHER_KEY)).toThrow();
});

test("a key that is not 32 bytes is rejected with the fix", () => {
  const short = Buffer.alloc(16).toString("base64");

  expect(() => parseSealKey(short)).toThrow(/32 bytes/);
  expect(() => seal(TOKEN, short)).toThrow(/openssl rand -base64 32/);
});

test("a value that was never sealed is refused", () => {
  expect(() => open(TOKEN, KEY)).toThrow(/v1\./);
  expect(() => open("v2.a.b.c", KEY)).toThrow(/v1\./);
});

test("only the tail of a token is exposed", () => {
  expect(tailOf(TOKEN)).toBe("1234");
  expect(tailOf(TOKEN)).not.toContain("ghp_");
});
