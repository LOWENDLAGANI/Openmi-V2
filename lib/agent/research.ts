import { lookup } from "node:dns/promises";

/**
 * Reading one page from the open web.
 *
 * Deliberately not a search API: a model that can ask a question gets an answer
 * it cannot verify, while a page it fetched is a source it can quote. This tool
 * takes one address and returns that page's title and readable text.
 *
 * The address is the risk. A URL-taking tool inside our own network is an SSRF
 * primitive, so every hop is checked before it is requested: https only, no
 * credentials in the URL, and no host that resolves to loopback, link-local,
 * private, CGNAT or multicast space. Redirects are followed by hand, up to
 * `FETCH_MAX_REDIRECTS`, re-checking each one — a public host that 302s to
 * `169.254.169.254` is the whole attack, and `redirect: "follow"` would walk it.
 *
 * Pure helpers, one `fetch`: the parsing and the HTML flattening are tested
 * without a network, which is also why this module carries no `server-only`.
 */

export const FETCH_MAX_BYTES = 200_000;
export const FETCH_MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 12_000;
export const FETCH_MAX_TEXT_CHARS = 8_000;
export const FETCH_USER_AGENT = "Openmi/0.1 (repository research)";

export const FETCH_URL_TOOL_SPEC = {
  name: "fetch_url",
  description:
    "Read one public web page over https and return its title and readable text, capped at 200,000 bytes. Use it to check documentation, a library version or an error message the repository does not explain. Refuses non-https addresses, credentials in the address, private and internal hosts, and more than three redirects.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "An https address, for example 'https://nextjs.org/docs/app/building-your-application'.",
      },
      purpose: {
        type: "string",
        description: "One readable line the reader sees, for example 'check the route config keys'.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
} as const;

export type FetchUrlResult =
  | { ok: true; text: string; tail?: string }
  | { ok: false; error: string };

/** A page that is not text is not research; say so rather than decoding bytes. */
function isTextual(contentType: string | null): boolean {
  if (!contentType) return true;

  const type = contentType.split(";")[0].trim().toLowerCase();

  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    type === "application/xhtml+xml" ||
    type === "application/rss+xml" ||
    type.endsWith("+json") ||
    type.endsWith("+xml")
  );
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }

  return octets;
}

function isBlockedV4(octets: number[]): boolean {
  const [a, b] = octets;

  if (a === 0 || a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;

  return false;
}

/**
 * Whether an address is ours, not the world's.
 *
 * The list is the one that matters in practice: loopback, the three private
 * ranges, link-local (cloud metadata lives at 169.254.169.254), CGNAT, the
 * documentation/benchmark blocks, multicast and reserved space, plus the v6
 * equivalents and v4-mapped forms of all of them.
 *
 * A public v6 address is allowed. Refusing every address with a colon would
 * refuse half the web, since a hostname resolving to an AAAA record is normal —
 * what must not pass is the local v6 space, and that is named here.
 */
export function isBlockedAddress(address: string): boolean {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, "");

  const mapped = value.startsWith("::ffff:") ? value.slice("::ffff:".length) : null;
  if (mapped !== null) {
    const octets = parseIPv4(mapped);
    return octets === null ? true : isBlockedV4(octets);
  }

  if (value.includes(":")) {
    if (value === "::" || value === "::1") return true;
    // fe80::/10 link-local
    if (/^fe[89ab]/.test(value)) return true;
    // fc00::/7 unique local
    if (/^f[cd]/.test(value)) return true;
    // ff00::/8 multicast
    if (value.startsWith("ff")) return true;
    return false;
  }

  const octets = parseIPv4(value);
  return octets === null ? false : isBlockedV4(octets);
}

/** Hostnames that are local by name, whatever they resolve to. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");

  if (host.length === 0) return true;
  if (host === "localhost") return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    return true;
  }

  return false;
}

/**
 * The URL this tool may request, or null.
 *
 * https only — a plain http page is either the same content behind a redirect or
 * something a reader should not be shown as a source. Credentials are refused
 * because a URL in a tool call is a URL in a transcript.
 */
export function parseFetchUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (raw.length === 0 || raw.length > 2_000) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (isBlockedHostname(url.hostname)) return null;
  if (isBlockedAddress(url.hostname)) return null;

  return url;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);

      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }

    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * A page, flattened to something a reader can quote.
 *
 * Not a readability engine: scripts, styles and comments are dropped, block
 * tags become line breaks, and the rest is collapsed. A page whose text this
 * mangles is still a page the model can cite a URL for, which is what the tool
 * promises.
 */
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : null;

  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|pre|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const text = decodeEntities(body)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();

  return { title: title && title.length > 0 ? title : null, text };
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Every address a host resolves to must be public; one private answer refuses it. */
async function resolveBlocked(url: URL): Promise<string | null> {
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // A literal needs no resolver, and asking for one would be a DNS request we
  // do not need.
  if (parseIPv4(host) !== null || host.includes(":")) {
    return isBlockedAddress(host) ? `${host} is not a public address` : null;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return `${host} could not be resolved`;
  }

  if (addresses.length === 0) return `${host} did not resolve to an address`;

  for (const entry of addresses) {
    if (isBlockedAddress(entry.address)) {
      return `${host} resolves to ${entry.address}, which is not a public address`;
    }
  }

  return null;
}

async function readCapped(
  response: Response
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    const room = FETCH_MAX_BYTES - total;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      total += room;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }

    chunks.push(value);
    total += value.byteLength;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes, truncated };
}

function describeNetworkError(caught: unknown): string {
  if (caught instanceof Error) {
    if (caught.name === "AbortError" || caught.name === "TimeoutError") {
      return `The page did not answer within ${FETCH_TIMEOUT_MS / 1000}s.`;
    }
    return caught.message.length > 0 ? caught.message : "The page could not be requested.";
  }

  return "The page could not be requested.";
}

export async function fetchUrl(args: Record<string, unknown> | null): Promise<FetchUrlResult> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: "bad-input: arguments were not a JSON object" };
  }

  if (Object.keys(args).some((key) => key !== "url" && key !== "purpose")) {
    return { ok: false, error: "bad-input: unexpected argument" };
  }

  const first = parseFetchUrl(args.url);
  if (!first) {
    return {
      ok: false,
      error:
        "bad-input: url must be a public https address, without credentials, and not a local or private host",
    };
  }

  let current = first;

  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop += 1) {
    const blocked = await resolveBlocked(current);
    if (blocked) return { ok: false, error: `refused: ${blocked}` };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": FETCH_USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1",
        },
      });
    } catch (caught) {
      return { ok: false, error: describeNetworkError(caught) };
    } finally {
      clearTimeout(timer);
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        return { ok: false, error: `refused: HTTP ${response.status} without a location` };
      }

      const next = parseFetchUrl(new URL(location, current).toString());
      if (!next) return { ok: false, error: "refused: the redirect points at an address this tool will not request" };

      current = next;
      continue;
    }

    const contentType = response.headers.get("content-type");
    if (!isTextual(contentType)) {
      return {
        ok: false,
        error: `refused: ${contentType ?? "that page"} is not text, so there is nothing to read`,
      };
    }

    let read: { bytes: Uint8Array; truncated: boolean };
    try {
      read = await readCapped(response);
    } catch (caught) {
      return { ok: false, error: describeNetworkError(caught) };
    }

    const raw = new TextDecoder("utf-8").decode(read.bytes);
    const { title, text } = htmlToText(raw);
    const trimmed =
      text.length > FETCH_MAX_TEXT_CHARS
        ? `${text.slice(0, FETCH_MAX_TEXT_CHARS)}\n\n[text cut at ${FETCH_MAX_TEXT_CHARS} characters]`
        : text;

    const header = [
      `${current.toString()} (HTTP ${response.status})`,
      title ? `title: ${title}` : null,
      read.truncated ? `note: the page was cut at ${FETCH_MAX_BYTES} bytes` : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    return {
      ok: true,
      text: `${header}\n\n${trimmed.length > 0 ? trimmed : "(no readable text)"}`,
      tail: trimmed.slice(0, 2_000),
    };
  }

  return { ok: false, error: `refused: more than ${FETCH_MAX_REDIRECTS} redirects` };
}
