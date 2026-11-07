import { expect, test } from "bun:test";

import { requestedBranch } from "../lib/github/branch-request";

test("a named default branch is the destination", () => {
  expect(requestedBranch("push it to main", "main")).toBe("main");
  expect(requestedBranch("can we make it can push to main?", "main")).toBe("main");
  expect(requestedBranch("commit straight to main", "main")).toBe("main");
});

test("any branch the reader names is taken, with or without backticks", () => {
  expect(requestedBranch("push this to the develop branch", "main")).toBe("develop");
  expect(requestedBranch("commit to `release/2.0`", "main")).toBe("release/2.0");
  expect(requestedBranch("land it in feature/login", "main")).toBe("feature/login");
  expect(requestedBranch("merge this into staging", "main")).toBe("staging");
});

test("a pull request names a base, not a destination", () => {
  expect(requestedBranch("open a pull request to main", "main")).toBeNull();
  expect(requestedBranch("raise a PR against main", "main")).toBeNull();
});

test("a path or a sentence about reading is not a branch request", () => {
  expect(requestedBranch("read main.ts and tell me what it does", "main")).toBeNull();
  expect(requestedBranch("what is in lib/context.ts?", "main")).toBeNull();
  expect(requestedBranch("push to https://example.com/main", "main")).toBeNull();
});

test("only a branch-shaped token after a write verb counts", () => {
  expect(requestedBranch("push it to the repo", "main")).toBeNull();
  expect(requestedBranch("commit to your local copy", "main")).toBeNull();
  expect(requestedBranch("main is the branch I deploy from", "main")).toBeNull();
  expect(requestedBranch("", "main")).toBeNull();
});

test("a token with an extension needs to be called a branch", () => {
  expect(requestedBranch("push to main.ts", "main")).toBeNull();
  expect(requestedBranch("push to the release.2026 branch", "main")).toBe("release.2026");
});
