import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/**
 * The caller's address, and a hash of it.
 *
 * Three rules:
 *
 * 1. The address is read from a header the platform sets, in the order Vercel
 *    overwrites them: `x-vercel-forwarded-for`, then `x-real-ip`, then
 *    `x-forwarded-for`. A deployment behind another proxy should have that proxy
 *    set the header rather than append to it; the first entry of a header a
 *    client can prepend is a claim, not an address.
 * 2. The value has to be an address. A hostname, a list, a port or free text is
 *    refused rather than hashed, so a forged header cannot invent a fresh bucket
 *    key of its own.
 * 3. It is stored only as a keyed hash. Counting a household is the point;
 *    retaining where everyone was is not.
 *
 * Even so, an address is not an identity and nothing here treats it as one: the
 * trial cap is a speed bump for account farms, not an authorisation decision.
 */

function firstValue(headers: Headers, name: string): string | null {
  const value = headers.get(name)?.split(",")[0]?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * One address, canonical, or null when the value is not one.
 *
 * Normalising matters because the same caller has several spellings: an
 * IPv4-mapped IPv6 address is the same host as its dotted form, a URL host may
 * arrive bracketed, and some proxies append a port. Left alone, each spelling
 * would be its own bucket and the cap would be trivially bypassed.
 */
export function normaliseIp(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  let candidate = value.trim().toLowerCase();
  if (candidate.length === 0) return null;

  // `[::1]` is how a URL spells an IPv6 host; the address is the inside.
  if (candidate.startsWith("[") && candidate.endsWith("]")) {
    candidate = candidate.slice(1, -1);
  }

  // `x-real-ip` on some proxies carries `address:port`.
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(candidate);
  if (withPort) candidate = withPort[1];

  // An IPv4-mapped IPv6 address is the same caller as its dotted form.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(candidate);
  if (mapped) candidate = mapped[1];

  return isIP(candidate) > 0 ? candidate : null;
}

/** The caller's address, or null when no header carried one this app trusts. */
export function requestIp(headers: Headers): string | null {
  return normaliseIp(
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
