import { expect, test } from "bun:test";

import { safeNextPath } from "../lib/http/next-path";

const ORIGIN = "https://app.example";

test("a same-origin next path is preserved", () => {
  expect(safeNextPath("/chat", ORIGIN)).toBe("/chat");
  expect(safeNextPath("/chat?tab=files&x=1", ORIGIN)).toBe("/chat?tab=files&x=1");
  expect(safeNextPath("/activity#ledger", ORIGIN)).toBe("/activity#ledger");
});

test("absolute, protocol-relative and backslash redirects are refused", () => {
  expect(safeNextPath("https://evil.example", ORIGIN)).toBe("/chat");
  expect(safeNextPath("//evil.example", ORIGIN)).toBe("/chat");
  expect(safeNextPath("/\\evil.example", ORIGIN)).toBe("/chat");
  expect(safeNextPath("/\\\\evil.example", ORIGIN)).toBe("/chat");
  expect(safeNextPath("/\t/evil.example", ORIGIN)).toBe("/chat");
  expect(safeNextPath("javascript:alert(1)", ORIGIN)).toBe("/chat");
});

test("empty and malformed values fall back", () => {
  expect(safeNextPath(null, ORIGIN)).toBe("/chat");
  expect(safeNextPath("", ORIGIN)).toBe("/chat");
  expect(safeNextPath("   ", ORIGIN)).toBe("/chat");
  expect(safeNextPath("/chat", "not an origin")).toBe("/chat");
});
