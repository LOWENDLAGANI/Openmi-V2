import { expect, test } from "bun:test";

import {
  FETCH_MAX_BYTES,
  FETCH_MAX_REDIRECTS,
  FETCH_URL_TOOL_SPEC,
  htmlToText,
  isBlockedAddress,
  parseFetchUrl,
} from "../lib/agent/research";
import { TOOL_SPECS } from "../lib/agent/tools";

/**
 * A URL-taking tool is an SSRF primitive unless the address is checked first.
 *
 * These cases are the ones that matter: the metadata endpoint every cloud box
 * exposes, the private ranges, loopback in both families, and the credential
 * form that would put a password in a transcript. The rule is allow-by-default
 * only for public https, which is why the private list is spelled out.
 */
test("only a public https address is fetched", () => {
  expect(parseFetchUrl("https://nextjs.org/docs/app")?.hostname).toBe("nextjs.org");
  expect(parseFetchUrl("  https://github.com/vercel/next.js  ")?.hostname).toBe("github.com");

  for (const blocked of [
    "",
    "   ",
    "http://example.com",
    "ftp://example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
    "https://localhost/admin",
    "https://api.localhost/",
    "https://127.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://10.0.0.7/",
    "https://192.168.1.1/",
    "https://172.16.0.1/",
    "https://100.64.0.1/",
    "https://[::1]/",
    "https://[fd00::1]/",
    "https://printer.local/",
    "https://metadata.internal/",
  ]) {
    expect(parseFetchUrl(blocked)).toBeNull();
  }

  // A public address is not refused just for being an address.
  expect(parseFetchUrl("https://8.8.8.8/")).not.toBeNull();
  expect(parseFetchUrl("https://[2606:4700:4700::1111]/")).not.toBeNull();
  expect(parseFetchUrl(42)).toBeNull();
});

test("local space is refused and public space is not", () => {
  for (const blocked of [
    "127.0.0.1",
    "10.1.2.3",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.1.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
  ]) {
    expect(isBlockedAddress(blocked)).toBe(true);
  }

  for (const allowed of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) {
    expect(isBlockedAddress(allowed)).toBe(false);
  }
});

test("a page becomes quotable text, not markup", () => {
  const page = `<!doctype html><html><head><title>Route config &amp; you</title>
    <style>body { color: red }</style><script>alert("x")</script></head>
    <body><h1>Hello&nbsp;there</h1><p>Catch-all routes use <code>[...slug]</code>.</p>
    <!-- a comment --></body></html>`;

  const { title, text } = htmlToText(page);

  expect(title).toBe("Route config & you");
  expect(text).toContain("Hello there");
  expect(text).toContain("[...slug]");
  expect(text).not.toContain("alert");
  expect(text).not.toContain("color: red");
  expect(text).not.toContain("<h1>");
  expect(text).not.toContain("a comment");
});

test("the tool surface keeps its shapes: addresses only on the sandbox side", () => {
  // The chat surface reads a repository and nothing else; `fetch_url` exists
  // only where a sandbox does, which is what lets the strict rule stay true.
  for (const tool of TOOL_SPECS) {
    expect(JSON.stringify(tool.parameters)).not.toContain('"url"');
  }

  expect(JSON.stringify(FETCH_URL_TOOL_SPEC.parameters)).toContain('"url"');
  expect(FETCH_MAX_BYTES).toBe(200_000);
  expect(FETCH_MAX_REDIRECTS).toBe(3);
});
