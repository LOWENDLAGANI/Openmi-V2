import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import {
  MAX_REPOS,
  MAX_SEARCH_FILE_FETCHES,
  MAX_SEARCH_HITS,
  MAX_TREE_ENTRIES,
  MAX_VIEW_BYTES,
  MAX_VIEW_LINES,
} from "../lib/github/read";

const DIR = new URL("../lib/github/", import.meta.url);
const FILES = readdirSync(DIR).filter((file) => file.endsWith(".ts"));

function source(file: string): string {
  return readFileSync(new URL(file, DIR), "utf8");
}

test("the GitHub read client has exactly one fetch call site", () => {
  // One call site is what makes "GET only" reviewable: there is nowhere else
  // for a request to come from.
  const matches = source("read.ts").match(/\bfetch\(/g) ?? [];
  expect(matches).toHaveLength(1);
});

test("every request under lib/github is a GET", () => {
  for (const file of FILES) {
    const text = source(file);
    const methods = text.match(/method:\s*"[A-Z]+"/g) ?? [];

    for (const method of methods) {
      expect(method).toBe('method: "GET"');
    }

    expect(text).not.toMatch(/"(POST|PUT|PATCH|DELETE)"/);
    expect(text).not.toMatch(/\baxios\b/);
  }
});

test("the viewer and search caps are named constants", () => {
  expect(MAX_SEARCH_HITS).toBe(20);
  expect(MAX_SEARCH_FILE_FETCHES).toBe(10);
  expect(MAX_TREE_ENTRIES).toBe(5_000);
  expect(MAX_VIEW_BYTES).toBe(200_000);
  expect(MAX_VIEW_LINES).toBe(2_000);
  expect(MAX_REPOS).toBe(300);
});

test("no GitHub token is ever read from a NEXT_PUBLIC variable", () => {
  for (const file of FILES) {
    expect(source(file)).not.toContain("NEXT_PUBLIC_GITHUB");
  }
});
