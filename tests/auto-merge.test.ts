import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  CONFLICT_REAPPLY_MESSAGE,
  deriveReplacement,
  mergeProposal,
  revertChangeset,
  type ChangedFile,
} from "../lib/github/write";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

type Call = { method: string; path: string; body: Record<string, unknown> | null };

type StubResult = { status?: number; body?: unknown } | null;

function stubFetch(
  handler: (method: string, path: string, body: Record<string, unknown> | null) => StubResult
): Call[] {
  const calls: Call[] = [];

  globalThis.fetch = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const path = String(input).replace("https://api.github.com", "");
    const method = String(init?.method ?? "GET");
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : null;

    calls.push({ method, path, body });

    const result = handler(method, path, body);

    if (!result) {
      return new Response(JSON.stringify({ message: "unexpected request" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    if (result.status === 204) return new Response(null, { status: 204 });

    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status ?? 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "100",
      },
    });
  }) as typeof fetch;

  return calls;
}

const noSleep = async () => {};

const BASE = {
  token: "sealed-token",
  repo: "octocat/hello",
  defaultBranch: "main",
  branch: "openmi/agent/changeset-1",
  prNumber: 7,
  changesetId: "changeset-1",
  sleep: noSleep,
};

function pull(mergeable: boolean | null, state: string) {
  return {
    body: {
      number: 7,
      html_url: "https://github.com/octocat/hello/pull/7",
      mergeable,
      mergeable_state: state,
    },
  };
}

function contents(text: string) {
  return { body: { type: "file", encoding: "base64", content: encode(text) } };
}

function encode(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

const REPLACE_FILE: ChangedFile = {
  path: "lib/a.ts",
  mode: "replace",
  original: "const a = 1;\nconst b = 2;\n",
  proposed: "const a = 1;\nconst b = 3;\n",
};

test("a clean pull request is squash-merged and its branch deleted", async () => {
  const calls = stubFetch((method, path) => {
    if (method === "GET" && path.endsWith("/pulls/7")) return pull(true, "clean");
    if (method === "PUT" && path.endsWith("/pulls/7/merge")) {
      return { body: { merged: true, sha: "merge-1" } };
    }
    if (method === "DELETE" && path.endsWith("/git/refs/heads/openmi/agent/changeset-1")) {
      return { status: 204 };
    }
    return null;
  });

  const outcome = await mergeProposal({
    ...BASE,
    files: [{ path: "lib/a.ts", mode: "write", original: null, proposed: "new\n" }],
  });

  expect(outcome).toEqual({
    ok: true,
    mergeCommitSha: "merge-1",
    reapplied: false,
  });

  const merge = calls.find((call) => call.method === "PUT");
  expect(merge?.path).toBe("/repos/octocat/hello/pulls/7/merge");
  expect(merge?.body).toEqual({ merge_method: "squash" });

  const deleted = calls.find((call) => call.method === "DELETE");
  expect(deleted?.path).toBe(
    "/repos/octocat/hello/git/refs/heads/openmi/agent/changeset-1"
  );

  expect(calls.some((call) => call.path.endsWith("/git/trees"))).toBe(false);
});

test("a dirty pull request re-applies the replacement on the live head", async () => {
  let pulls = 0;

  const calls = stubFetch((method, path) => {
    if (method === "GET" && path.endsWith("/pulls/7")) {
      pulls += 1;
      return pulls === 1 ? pull(false, "dirty") : pull(true, "clean");
    }
    if (method === "GET" && path.endsWith("/git/ref/heads/main")) {
      return { body: { object: { sha: "head-2" } } };
    }
    if (method === "GET" && path.includes("/contents/lib/a.ts?ref=head-2")) {
      return contents("const a = 1;\nconst b = 2;\nconst c = 4;\n");
    }
    if (method === "GET" && path.endsWith("/git/commits/head-2")) {
      return { body: { tree: { sha: "tree-head-2" } } };
    }
    if (method === "POST" && path.endsWith("/git/trees")) {
      return { body: { sha: "tree-new" } };
    }
    if (method === "POST" && path.endsWith("/git/commits")) {
      return { body: { sha: "commit-new" } };
    }
    if (
      method === "PATCH" &&
      path.endsWith("/git/refs/heads/openmi/agent/changeset-1")
    ) {
      return { body: { object: { sha: "commit-new" } } };
    }
    if (method === "PUT" && path.endsWith("/pulls/7/merge")) {
      return { body: { merged: true, sha: "merge-2" } };
    }
    if (method === "DELETE" && path.includes("/git/refs/heads/")) {
      return { status: 204 };
    }
    return null;
  });

  const outcome = await mergeProposal({ ...BASE, files: [REPLACE_FILE] });

  expect(outcome).toEqual({
    ok: true,
    mergeCommitSha: "merge-2",
    reapplied: true,
  });

  const tree = calls.find((call) => call.method === "POST" && call.path.endsWith("/git/trees"));
  expect(tree?.body?.base_tree).toBe("tree-head-2");
  const entries = tree?.body?.tree as Array<{ path: string; content: string }>;
  expect(entries).toHaveLength(1);
  expect(entries[0].content).toBe("const a = 1;\nconst b = 3;\nconst c = 4;\n");

  const commit = calls.find(
    (call) => call.method === "POST" && call.path.endsWith("/git/commits")
  );
  expect(commit?.body?.parents).toEqual(["head-2"]);
  expect(commit?.body?.tree).toBe("tree-new");

  const moved = calls.find((call) => call.method === "PATCH");
  expect(moved?.path).toBe("/repos/octocat/hello/git/refs/heads/openmi/agent/changeset-1");
  expect(moved?.body).toEqual({ sha: "commit-new", force: false });

  expect(pulls).toBe(2);
});

test("a replacement that no longer matches exactly once closes the pull request", async () => {
  const calls = stubFetch((method, path) => {
    if (method === "GET" && path.endsWith("/pulls/7")) return pull(false, "dirty");
    if (method === "GET" && path.endsWith("/git/ref/heads/main")) {
      return { body: { object: { sha: "head-3" } } };
    }
    if (method === "GET" && path.includes("/contents/lib/a.ts?ref=head-3")) {
      return contents("const b = 2;\nconst b = 2;\n");
    }
    if (method === "PATCH" && path.endsWith("/pulls/7")) {
      return { body: { number: 7, state: "closed" } };
    }
    if (method === "DELETE" && path.includes("/git/refs/heads/")) {
      return { status: 204 };
    }
    return null;
  });

  const outcome = await mergeProposal({ ...BASE, files: [REPLACE_FILE] });

  expect(outcome).toEqual({
    ok: false,
    error: CONFLICT_REAPPLY_MESSAGE,
    pullRequestClosed: true,
  });

  const closed = calls.find(
    (call) => call.method === "PATCH" && call.path.endsWith("/pulls/7")
  );
  expect(closed?.body).toEqual({ state: "closed" });

  expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  expect(calls.some((call) => call.method === "PUT")).toBe(false);
});

test("a 405 from the merge re-polls and retries once", async () => {
  let merges = 0;

  const calls = stubFetch((method, path) => {
    if (method === "GET" && path.endsWith("/pulls/7")) return pull(true, "clean");
    if (method === "PUT" && path.endsWith("/pulls/7/merge")) {
      merges += 1;
      if (merges === 1) {
        return { status: 405, body: { message: "Base branch was modified" } };
      }
      return { body: { merged: true, sha: "merge-3" } };
    }
    if (method === "DELETE" && path.includes("/git/refs/heads/")) {
      return { status: 204 };
    }
    return null;
  });

  const outcome = await mergeProposal({
    ...BASE,
    files: [{ path: "lib/a.ts", mode: "write", original: null, proposed: "new\n" }],
  });

  expect(outcome).toEqual({
    ok: true,
    mergeCommitSha: "merge-3",
    reapplied: false,
  });
  expect(merges).toBe(2);
  expect(calls.filter((call) => call.method === "GET" && call.path.endsWith("/pulls/7")))
    .toHaveLength(2);
});

test("undo builds a revert commit on the current head and moves it without force", async () => {
  const calls = stubFetch((method, path) => {
    if (method === "GET" && path.endsWith("/git/ref/heads/main")) {
      return { body: { object: { sha: "head-9" } } };
    }
    if (method === "GET" && path.endsWith("/git/commits/head-9")) {
      return { body: { tree: { sha: "tree-head-9" } } };
    }
    if (method === "POST" && path.endsWith("/git/trees")) {
      return { body: { sha: "tree-revert" } };
    }
    if (method === "POST" && path.endsWith("/git/commits")) {
      return { body: { sha: "commit-revert" } };
    }
    if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
      return { body: { object: { sha: "commit-revert" } } };
    }
    return null;
  });

  const outcome = await revertChangeset({
    token: BASE.token,
    repo: BASE.repo,
    defaultBranch: "main",
    changesetId: BASE.changesetId,
    files: [
      { path: "lib/a.ts", original: "old\n" },
      { path: "lib/new.ts", original: null },
    ],
  });

  expect(outcome).toEqual({ commitSha: "commit-revert", headSha: "head-9" });

  const tree = calls.find((call) => call.method === "POST" && call.path.endsWith("/git/trees"));
  expect(tree?.body?.base_tree).toBe("tree-head-9");
  const entries = tree?.body?.tree as Array<{
    path: string;
    mode: string;
    type: string;
    content?: string;
    sha?: null;
  }>;
  expect(entries).toEqual([
    { path: "lib/a.ts", mode: "100644", type: "blob", content: "old\n" },
    { path: "lib/new.ts", mode: "100644", type: "blob", sha: null },
  ]);

  const commit = calls.find(
    (call) => call.method === "POST" && call.path.endsWith("/git/commits")
  );
  expect(commit?.body?.parents).toEqual(["head-9"]);
  expect(commit?.body?.tree).toBe("tree-revert");

  const moved = calls.find((call) => call.method === "PATCH");
  expect(moved?.path).toBe("/repos/octocat/hello/git/refs/heads/main");
  expect(moved?.body).toEqual({ sha: "commit-revert", force: false });
});

test("a replacement is derived from the stored base and proposed content", () => {
  expect(
    deriveReplacement("const a = 1;\nconst b = 2;\n", "const a = 1;\nconst b = 3;\n")
  ).toEqual({ find: "2", replace: "3" });

  expect(deriveReplacement("same", "same")).toBeNull();
  expect(deriveReplacement("", "inserted")).toBeNull();
});

test("the approval path stores the merge commit it was given", () => {
  const source = readFileSync(
    new URL("../lib/changesets/commit.ts", import.meta.url),
    "utf8"
  );

  expect(source).toContain("mergeProposal(");
  expect(source).toContain("merge_commit_sha: mergeCommitSha");
  expect(source).toContain("status: \"failed\"");
});
