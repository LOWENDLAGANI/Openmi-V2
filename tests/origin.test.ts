import { expect, test } from "bun:test";

import { isSameOrigin, requestOrigin } from "../lib/http/origin";

/**
 * The mission routes spend Credit and start sandboxes, so this check is the only
 * thing standing between a forged cross-site POST and a bill. These assertions
 * pin both halves: a stranger is refused, and the deployment's own panel is
 * not, whichever host it happens to be served from.
 */

function post(headers: Record<string, string>, url = "https://openmi.app/api/missions") {
  return new Request(url, { method: "POST", headers });
}

test("a browser-less caller without an Origin header is allowed", () => {
  expect(isSameOrigin(post({}), "https://openmi.app")).toBe(true);
});

test("the configured site url is accepted", () => {
  expect(
    isSameOrigin(post({ origin: "https://openmi.app" }), "https://openmi.app")
  ).toBe(true);
});

test("a preview or custom-domain host is accepted when the config points elsewhere", () => {
  const request = post({
    origin: "https://openmi-git-main-me.vercel.app",
    host: "openmi-git-main-me.vercel.app",
  });

  expect(isSameOrigin(request, "https://openmi.app")).toBe(true);
});

test("a proxy that sets x-forwarded-host is honoured", () => {
  const request = post({
    origin: "https://pv-abc.style.dev",
    host: "127.0.0.1:3000",
    "x-forwarded-host": "pv-abc.style.dev, 127.0.0.1:3000",
  });

  expect(isSameOrigin(request, "https://openmi.app")).toBe(true);
});

test("the serving host counts even when the scheme was terminated upstream", () => {
  const request = post({ origin: "https://openmi.app", host: "openmi.app" },
    "http://openmi.app/api/missions");

  expect(isSameOrigin(request, "https://elsewhere.test")).toBe(true);
});

test("another site is refused", () => {
  const request = post({
    origin: "https://evil.test",
    host: "openmi.app",
  });

  expect(isSameOrigin(request, "https://openmi.app")).toBe(false);
});

test("a malformed Origin is refused", () => {
  expect(isSameOrigin(post({ origin: "not a url" }), "https://openmi.app")).toBe(false);
});

test("a bare domain in the environment file is read as https, not ignored", () => {
  const request = post({ origin: "https://evil.test", host: "openmi.app" });

  expect(isSameOrigin(request, "openmi.app")).toBe(false);
  expect(isSameOrigin(post({ origin: "https://openmi.app" }), "openmi.app")).toBe(true);
});

test("a redirect is built from the browser's host, not the bind address", () => {
  // `next dev --hostname 0.0.0.0`, or a proxy in front of the app, hands the
  // route a request URL on the internal address. A redirect_uri built from that
  // is a string GitHub has never heard of, which is the whole bug.
  const internal = new Request("http://0.0.0.0:3000/auth/github", {
    headers: { host: "openmi.app", "x-forwarded-proto": "https" },
  });

  expect(requestOrigin(internal)).toBe("https://openmi.app");
});

test("a loopback request stays http so local sign-in keeps working", () => {
  const local = new Request("http://127.0.0.1:3000/auth/github", {
    headers: { host: "localhost:3000" },
  });

  expect(requestOrigin(local)).toBe("http://localhost:3000");
});

test("a public host is https even when the proxy sent no proto header", () => {
  const request = new Request("http://openmi.app/auth/github", {
    headers: { host: "openmi.app" },
  });

  expect(requestOrigin(request)).toBe("https://openmi.app");
});

test("with nothing configured there is no policy to enforce", () => {
  expect(isSameOrigin(post({ origin: "https://evil.test" }), "")).toBe(true);
  expect(isSameOrigin(post({ origin: "https://evil.test" }), null)).toBe(true);
});
