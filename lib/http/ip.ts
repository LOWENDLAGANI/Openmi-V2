import { createHmac } from "node:crypto";

/**
 * The caller's address, and a hash of it.
 *
 * Two rules:
 *
 * 1. The address is read from a header the platform sets, never from anything
 *    the reader types. `x-vercel-forwarded-for` is overwritten at the edge, so a
 *    forged `x-forwarded-for` cannot move the caller to a fresh bucket.
 * 2. It is stored only as a keyed hash. Counting a household is the point;
 *    retaining where everyone was is not.
 *
 * The first address is best effort by design. A proxy or a rotating mobile
 * address is not an identity, and nothing here treats it as one: the trial cap
 * is a speed bump for account farms, not an authorisation decision.
 */

function firstValue(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.split(",")[0]?.trim();
  return value && value.length > 0 ? value : null;
}

/** The caller's address, or null when the platform did not supply one. */
export function requestIp(headers: Headers): string | null {
  return (
    firstValue(headers, "x-vercel-forwarded-for") ??
    firstValue(headers, "x-real-ip") ??
    firstValue(headers, "x-forwarded-for")
  );
}

/**
 * A stable, keyed hash of one address.
 *
 * The secret is the deployment's own; without it the same address hashes the
 * same way everywhere and the value becomes a weak pseudonym. A caller that has
 * no secret must skip the grant rather than store a reversible value.
 */
export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(ip.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}
