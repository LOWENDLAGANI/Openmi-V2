import { afterEach, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  GithubWriteError,
  agentBranchName,
  assertAgentBranch,
  commitProposal,
} from "../lib/github/write";

const ROOT = join(import.meta.dir, "..");
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

type Call = { method: string; path: string; body: Record<string, unknown> | null };

type StubResult = { status?: number; body?: unknown } | null;

function stubFetch(handler: (method: string, path: string, body: Record<string, unknown> | null) => StubResult): Call[] {
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

const BASE = {
  token: "sealed-token",
  repo: "octocat/hello",
  defaultBranch: "main",
  baseBranch: "main",
  baseSha: "base-1",
  files: [{ path: "lib/a.ts", content: "export const a = 1;\n" }],
  changesetId: "changeset-1",
};

function happyPath(method: string, path: string): StubResult {
  if (method === "GET" && path.endsWith("/git/commits/base-1")) {
    return { body: { tree: { sha: "tree-base" } } };
  }
  if (method === "POST" && path.endsWith("/git/trees")) {
    return { body: { sha: "tree-1" } };
  }
  if (method === "POST" && path.endsWith("/git/commits")) {
    return { body: { sha: "commit-1" } };
  }
  if (method === "POST" && path.endsWith("/git/refs")) {
    return { body: { object: { sha: "commit-1" } } };
  }
  if (method === "POST" && path.endsWith("/pulls")) {
    return {
      body: { html_url: "https://github.com/octocat/hello/pull/7", number: 7 },
    };
  }
  return null;
}

test("only agent branches can be written, and the default branch is refused", () => {
  expect(agentBranchName("Changeset-ABC_1")).toBe("openmi/agent/changeset-abc-1");
  expect(() => assertAgentBranch(agentBranchName("anything"), "main")).not.toThrow();

  for (const branch of [
    "main",
    "master",
    "feature/mine",
    "refs/heads/main",
    "openmi/agent/",
    "openmi/agent/UPPER",
  ]) {
    expect(() => assertAgentBranch(branch, "main")).toThrow(/only commits to agent/);
  }

  try {
    assertAgentBranch("main", "main");
  } catch (caught) {
    expect(caught).toBeInstanceOf(GithubWriteError);
    expect((caught as GithubWriteError).status).toBe(403);
  }
});

test("one approval creates one agent branch, one commit and one PR", async () => {
  const calls = stubFetch(happyPath);

  const outcome = await commitProposal(BASE);

  expect(outcome).toEqual({
    branch: "openmi/agent/changeset-1",
    baseBranch: "main",
    commitSha: "commit-1",
    prUrl: "https://github.com/octocat/hello/pull/7",
    prNumber: 7,
  });

  const tree = calls.find((call) => call.method === "POST" && call.path.endsWith("/git/trees"));
  expect(tree?.body?.base_tree).toBe("tree-base");

  const entries = tree?.body?.tree as Array<{ path: string; content: string }>;
  expect(entries).toHaveLength(1);
  expect(entries[0].path).toBe("lib/a.ts");
  expect(entries[0].content).toContain("export const a");

  const commit = calls.find((call) => call.method === "POST" && call.path.endsWith("/git/commits"));
  expect(commit?.body?.parents).toEqual(["base-1"]);
  expect(commit?.body?.tree).toBe("tree-1");

  const ref = calls.find((call) => call.method === "POST" && call.path.endsWith("/git/refs"));
  expect(ref?.body?.ref).toBe("refs/heads/openmi/agent/changeset-1");

  const pr = calls.find((call) => call.method === "POST" && call.path.endsWith("/pulls"));
  expect(pr?.body?.head).toBe("openmi/agent/changeset-1");
  expect(pr?.body?.base).toBe("main");
  expect(String(pr?.body?.body)).toContain("did not run code");

  expect(calls.filter((call) => call.path.endsWith("/pulls"))).toHaveLength(1);
});

test("a retry with the stored commit does not create a second commit", async () => {
  const calls = stubFetch(happyPath);

  await commitProposal({ ...BASE, existingCommitSha: "commit-1" });

  expect(
    calls.some(
      (call) =>
        call.method === "POST" &&
        (call.path.endsWith("/git/trees") || call.path.endsWith("/git/commits"))
    )
  ).toBe(false);

  expect(calls.some((call) => call.method === "POST" && call.path.endsWith("/pulls"))).toBe(true);
});

test("a second open PR for the same branch is reused, not duplicated", async () => {
  stubFetch((method, path) => {
    if (method === "POST" && path.endsWith("/pulls")) {
      return { status: 422, body: { message: "A pull request already exists" } };
    }
    if (method === "GET" && path.includes("/pulls?head=")) {
      return {
        body: [{ html_url: "https://github.com/octocat/hello/pull/9", number: 9 }],
      };
    }
    if (method === "POST" && path.endsWith("/git/refs")) {
      return { body: { object: { sha: "commit-1" } } };
    }
    return null;
  });

  const outcome = await commitProposal({ ...BASE, existingCommitSha: "commit-1" });

  expect(outcome.prNumber).toBe(9);
  expect(outcome.prUrl).toBe("https://github.com/octocat/hello/pull/9");
});

test("a branch that already points at another commit is refused", async () => {
  stubFetch((method, path) => {
    if (method === "POST" && path.endsWith("/git/refs")) {
      return { status: 422, body: { message: "Reference already exists" } };
    }
    if (method === "GET" && path.endsWith("/git/ref/heads/openmi/agent/changeset-1")) {
      return { body: { object: { sha: "someone-elses-commit" } } };
    }
    return null;
  });

  await expect(
    commitProposal({ ...BASE, existingCommitSha: "commit-1" })
  ).rejects.toThrow(/already points at another commit/);
});

test("a base branch that is not the default branch is refused before any request", async () => {
  const calls = stubFetch(happyPath);

  await expect(commitProposal({ ...BASE, baseBranch: "release" })).rejects.toThrow(
    /default branch/
  );
  expect(calls).toHaveLength(0);
});

test("a permission failure names the scopes the token needs", async () => {
  stubFetch((method, path) => {
    if (method === "GET" && path.endsWith("/git/commits/base-1")) {
      return { body: { tree: { sha: "tree-base" } } };
    }
    if (method === "POST" && path.endsWith("/git/trees")) {
      return { status: 403, body: {} };
    }
    return null;
  });

  await expect(commitProposal(BASE)).rejects.toThrow(/Contents: read and write/);
});

test("only the approval path imports the GitHub write client", () => {
  const files = (readdirSync(ROOT, { recursive: true }) as string[])
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter(
      (file) =>
        !file.startsWith("node_modules") &&
        !file.startsWith(".next") &&
        !file.startsWith(".git") &&
        !file.startsWith("tests/")
    );

  const offenders = files.filter((file) => {
    if (file === "lib/changesets/commit.ts") return false;
    const text = readFileSync(join(ROOT, file), "utf8");
    return /from\s+"@\/lib\/github\/write"/.test(text);
  });

  expect(offenders).toEqual([]);
});
