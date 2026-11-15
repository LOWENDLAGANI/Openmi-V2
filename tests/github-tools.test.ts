import { expect, test } from "bun:test";

import type { SandboxHandle } from "../lib/execution/provider";
import { toolSummary } from "../lib/runs/events";
import {
  RUN_TOOL_SPECS,
  executeRunTool,
  parseGithubAction,
  parseGithubRead,
  parseHistoryRequest,
} from "../lib/runs/tools";

const sandbox = {
  exec: async () => ({ exitCode: 0, output: "README.md\nlib/a.ts\nlib/b/c.ts\n", timedOut: false }),
} as unknown as SandboxHandle;

const run = (name: string, args: Record<string, unknown> | null) =>
  executeRunTool({ name, args, sandbox, github: null });

test("a github_read asks for one thing and nothing else", () => {
  expect(parseGithubRead({ kind: "pulls" })).toEqual({
    ok: true,
    request: { kind: "pulls", state: "open" },
  });

  // `all` and `closed` are the only other states.
  expect(parseGithubRead({ kind: "issues", state: "all" })).toEqual({
    ok: true,
    request: { kind: "issues", state: "all" },
  });

  expect(parseGithubRead({ kind: "pull", number: 12 })).toEqual({
    ok: true,
    request: { kind: "pull", number: 12 },
  });

  // Checks are about a ref, so a ref is required and a number is refused.
  expect(parseGithubRead({ kind: "checks", ref: "main" }).ok).toBe(true);
  expect(parseGithubRead({ kind: "checks" }).ok).toBe(false);
  expect(parseGithubRead({ kind: "checks", ref: "main", number: 3 }).ok).toBe(false);

  expect(parseGithubRead({ kind: "branches" }).ok).toBe(true);

  expect(parseGithubRead(null).ok).toBe(false);
  expect(parseGithubRead({ kind: "commits" }).ok).toBe(false);
  expect(parseGithubRead({ kind: "pulls", state: "merged" }).ok).toBe(false);
  expect(parseGithubRead({ kind: "pull", number: 0 }).ok).toBe(false);
  expect(parseGithubRead({ kind: "pull", number: 1.5 }).ok).toBe(false);
  expect(parseGithubRead({ kind: "pull", number: 1, extra: true }).ok).toBe(false);
  expect(parseGithubRead({ kind: "branches", state: "open" }).ok).toBe(false);
});

test("a github_action names its object and its content", () => {
  expect(parseGithubAction({ kind: "comment", number: 4, body: "Thanks" })).toEqual({
    ok: true,
    request: { kind: "comment", number: 4, body: "Thanks" },
  });

  expect(parseGithubAction({ kind: "comment", number: 4 }).ok).toBe(false);
  expect(parseGithubAction({ kind: "comment", body: "no number" }).ok).toBe(false);

  expect(
    parseGithubAction({ kind: "open_issue", title: "Crash", labels: ["bug"] })
  ).toEqual({
    ok: true,
    request: { kind: "open_issue", title: "Crash", body: "", labels: ["bug"] },
  });

  expect(parseGithubAction({ kind: "open_issue" }).ok).toBe(false);
  expect(parseGithubAction({ kind: "open_issue", title: "x", labels: ["not a label!"] }).ok).toBe(false);

  // Merge defaults to squash, and a method outside the three is refused.
  expect(parseGithubAction({ kind: "merge_pull", number: 9 })).toEqual({
    ok: true,
    request: { kind: "merge_pull", number: 9, method: "squash" },
  });
  expect(parseGithubAction({ kind: "merge_pull", number: 9, method: "rebase" }).ok).toBe(true);
  expect(parseGithubAction({ kind: "merge_pull", number: 9, method: "fast-forward" }).ok).toBe(false);

  expect(parseGithubAction({ kind: "close_issue", number: 2 })).toEqual({
    ok: true,
    request: { kind: "close_issue", number: 2 },
  });
  expect(parseGithubAction({ kind: "close_issue", number: 2, body: "bye" }).ok).toBe(false);

  expect(parseGithubAction({ kind: "label_issue", number: 2, labels: ["bug"] }).ok).toBe(true);
  expect(parseGithubAction({ kind: "label_issue", number: 2 }).ok).toBe(false);

  expect(parseGithubAction({ kind: "delete_repo" }).ok).toBe(false);
  expect(parseGithubAction({ kind: "comment", number: 1, body: "x", url: "https://x" }).ok).toBe(false);
});

test("history is read by path, by commit, or recent first", () => {
  expect(parseHistoryRequest({})).toEqual({
    ok: true,
    request: { limit: 20 },
  });

  expect(parseHistoryRequest({ path: "lib/runs/tools.ts", limit: 5 })).toEqual({
    ok: true,
    request: { path: "lib/runs/tools.ts", limit: 5 },
  });

  expect(parseHistoryRequest({ sha: "a0403184c8137bf1ffefe3bc363a22c37aeeb786" }).ok).toBe(true);

  expect(parseHistoryRequest({ path: "../outside" }).ok).toBe(false);
  expect(parseHistoryRequest({ sha: "not-a-sha" }).ok).toBe(false);
  expect(parseHistoryRequest({ limit: 500 })).toEqual({ ok: true, request: { limit: 20 } });
  expect(parseHistoryRequest({ branch: "main" }).ok).toBe(false);
});

test("the four tools are advertised", () => {
  for (const name of ["list_files", "git_history", "github_read", "github_action"]) {
    expect(RUN_TOOL_SPECS.some((spec) => spec.name === name)).toBe(true);
  }

  const action = RUN_TOOL_SPECS.find((spec) => spec.name === "github_action");
  expect(JSON.stringify(action?.parameters)).toContain("merge_pull");
});

test("without a connection the GitHub tools say so instead of failing silently", async () => {
  const history = await run("git_history", {});
  expect(history.ok).toBe(false);
  expect(history.text).toContain("no GitHub connection");

  const read = await run("github_read", { kind: "pulls" });
  expect(read.ok).toBe(false);
  expect(read.text).toContain("no GitHub connection");

  const write = await run("github_action", { kind: "close_issue", number: 3 });
  expect(write.ok).toBe(false);
  expect(write.text).toContain("no GitHub connection");
});

test("a bad argument never reaches GitHub", async () => {
  const attempts = await run("github_action", { kind: "comment", number: 3 });

  expect(attempts.ok).toBe(false);
  expect(attempts.text).toContain("a body is required");
});

test("list_files lists paths under a prefix", async () => {
  const all = await run("list_files", {});
  expect(all.ok).toBe(true);
  expect(all.text).toContain("README.md");

  const under = await run("list_files", { prefix: "lib" });
  expect(under.ok).toBe(true);
  expect(under.preview).toBe("listed 3 path(s)");

  expect((await run("list_files", { prefix: "../etc" })).ok).toBe(false);
});

test("the stream says what the GitHub tools are doing", () => {
  expect(toolSummary("git_history", { path: "lib/runs/tools.ts" })).toBe(
    "reading the history of lib/runs/tools.ts"
  );
  expect(toolSummary("git_history", {})).toBe("reading commit history");
  expect(toolSummary("github_action", { kind: "merge_pull", number: 12 })).toBe(
    "merging pull request #12"
  );
  expect(toolSummary("github_read", { kind: "issues" })).toBe("reading issues");
});
