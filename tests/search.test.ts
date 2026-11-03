import { describe, expect, test } from "bun:test";

import { escapeLike, snippetAround } from "../lib/search";

test("ilike wildcards in a query are escaped, not honoured", () => {
  expect(escapeLike("50%")).toBe("50\\%");
  expect(escapeLike("a_b")).toBe("a\\_b");
  expect(escapeLike("back\\slash")).toBe("back\\\\slash");
  expect(escapeLike("plain words")).toBe("plain words");
});

test("the snippet is a window around the match", () => {
  const content = `${"a".repeat(120)} the retry envelope ${"b".repeat(120)}`;
  const snippet = snippetAround(content, "retry envelope", 20);

  expect(snippet).toContain("retry envelope");
  expect(snippet.startsWith("…")).toBe(true);
  expect(snippet.endsWith("…")).toBe(true);
  expect(snippet.length).toBeLessThan(content.length);
});

test("a match near the start has no leading ellipsis", () => {
  const snippet = snippetAround("retry envelope is enforced at the edge", "retry", 20);

  expect(snippet.startsWith("retry")).toBe(true);
  expect(snippet.startsWith("…")).toBe(false);
});

test("a query with no match still returns readable text", () => {
  const snippet = snippetAround("nothing related here", "zebra", 8);

  expect(snippet.length).toBeGreaterThan(0);
  expect(snippet.length).toBeLessThanOrEqual(20);
});

test("whitespace is collapsed in a snippet", () => {
  expect(snippetAround("line one\n\n   line two", "line two")).toBe("line one line two");
});
