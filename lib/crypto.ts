import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * AES-256-GCM sealing for credentials the server must keep at rest.
 *
 * Two properties matter here, and neither is provided by hashing:
 *
 * 1. A sealed token can be opened again, because the GitHub client has to send
 *    it upstream. Hashing would be safer and useless.
 * 2. Tampering is detected rather than decrypted into nonsense. GCM's tag is
 *    checked before any plaintext is returned, so a flipped byte in the
 *    database is an error, not a corrupted token sent to GitHub.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, all base64url, so the version can move
 * without guessing at column contents. AAD is deliberately absent: the owner id
 * is not needed to authenticate the value, and binding it would make a
 * connection impossible to migrate between deployments.
 *
 * This module is deliberately free of `server-only`: the tests import it, and
 * `server-only` throws on import outside a React server environment. It is
 * still never imported by a client component.
 */

export const SEAL_VERSION = "v1";
export const SEAL_KEY_BYTES = 32;
export const SEAL_TAG_BYTES = 16;
const IV_BYTES = 12;

/** Reads the key exactly as `/setup` describes it: 32 bytes, base64. */
export function parseSealKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key.trim(), "base64");

  if (key.length !== SEAL_KEY_BYTES) {
    throw new Error(
      `GITHUB_TOKEN_KEY must decode to exactly ${SEAL_KEY_BYTES} bytes. Generate one with: openssl rand -base64 32`
    );
  }

  return key;
}

export function seal(plaintext: string, base64Key: string): string {
  const key = parseSealKey(base64Key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    SEAL_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function open(sealed: string, base64Key: string): string {
  const parts = sealed.split(".");

  if (parts.length !== 4 || parts[0] !== SEAL_VERSION) {
    throw new Error("Sealed value is not in the v1.<iv>.<tag>.<ciphertext> format.");
  }

  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");

  if (iv.length !== IV_BYTES) throw new Error("Sealed value has an invalid nonce.");
  if (tag.length !== SEAL_TAG_BYTES) throw new Error("Sealed value has an invalid tag.");

  const key = parseSealKey(base64Key);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  // GCM throws here on a tampered tag, nonce or ciphertext, before any
  // plaintext exists. That is the whole point of the mode.
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return plaintext.toString("utf8");
}

/**
 * Whether two values are equal, in time that does not depend on where they
 * first differ or on how long they are.
 *
 * Hashing first is what makes the comparison length-independent: a value an
 * attacker sends is not the length of the secret, and `timingSafeEqual` throws
 * on different lengths. This is the same shape the cron route uses for its
 * bearer token, and it is what an OAuth state cookie is compared with.
 */
export function secretsMatch(given: string, expected: string): boolean {
  const left = createHash("sha256").update(given, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();

  return timingSafeEqual(left, right);
}

/** The only part of a token that may be shown back to a person. */
export function tailOf(token: string): string {
  return token.slice(-4);
}
