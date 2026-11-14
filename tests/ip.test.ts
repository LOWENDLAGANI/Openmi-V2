import { expect, test } from "bun:test";

import { normaliseIp, requestIp } from "../lib/http/ip";

function headers(values: Record<string, string>): Headers {
  const set = new Headers();
  for (const [name, value] of Object.entries(values)) set.set(name, value);
  return set;
}

test("the platform header wins over one a client can send", () => {
  const request = headers({
    "x-vercel-forwarded-for": "203.0.113.9",
    "x-real-ip": "198.51.100.7",
    "x-forwarded-for": "192.0.2.1",
  });

  expect(requestIp(request)).toBe("203.0.113.9");
});

test("a header that does not carry an address is ignored", () => {
  expect(normaliseIp("not-an-address")).toBeNull();
  expect(normaliseIp("example.com")).toBeNull();
  expect(normaliseIp("")).toBeNull();
  expect(normaliseIp(null)).toBeNull();
  expect(requestIp(headers({ "x-forwarded-for": "banana" }))).toBeNull();
});

test("the same caller in different spellings is one bucket", () => {
  expect(normaliseIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
  expect(normaliseIp("[::1]")).toBe("::1");
  expect(normaliseIp("203.0.113.9:443")).toBe("203.0.113.9");
  expect(normaliseIp("  203.0.113.9  ")).toBe("203.0.113.9");
});
