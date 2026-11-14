import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { APPLY_CONFLICT_MESSAGE, runApply } from "../lib/changesets/apply";
import {
  CONFIRM_FILE_LIMIT,
  needsConfirmation,
  touchesSensitivePath,
  withStandingApproval,
} from "../lib/changesets/confirmation";
import { markChangesetReviewed, rejectChangeset } from "../lib/changesets/decide";
import { commitProposal } from "../lib/github/write";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ── The dialog decision ──────────────────────────────────────────────────────

const CLEAN = {
  base_sha: "a".repeat(40),
  reviewed_at: "2026-11-01T00:00:00.000Z",
  files: [{ path: "lib/changesets/store.ts" }, { path: "app/chat/page.tsx" }],
};

test("a clean, reviewed, small change applies without a dialog", () => {
  expect(needsConfirmation(CLEAN, CLEAN.base_sha)).toBe(false);
});

test("a moved head asks first", () => {
  expect(needsConfirmation(CLEAN, "b".repeat(40))).toBe(true);
  // A head that could not be read is not evidence that nothing moved.
  expect(needsConfirmation(CLEAN, null)).toBe(true);
});

test("more than five files asks first", () => {
  const files = Array.from({ length: CONFIRM_FILE_LIMIT }, (_, index) => ({
    path: `lib/file-${index}.ts`,
  }));

  expect(CONFIRM_FILE_LIMIT).toBe(5);
  expect(needsConfirmation({ ...CLEAN, files }, CLEAN.base_sha)).toBe(false);
  expect(
    needsConfirmation(
      { ...CLEAN, files: [...files, { path: "lib/one-more.ts" }] },
      CLEAN.base_sha
    )
  ).toBe(true);
});

test("a config, auth or schema path asks first", () => {
  for (const path of [
    ".env",
    ".env.local",
    "package.json",
    "app/auth/session.ts",
    "next.config.mjs",
    "lib/config/database.ts",
    "supabase/migrations/031_apply_review.sql",
  ]) {
    expect(touchesSensitivePath(path)).toBe(true);
    expect(needsConfirmation({ ...CLEAN, files: [{ path }] }, CLEAN.base_sha)).toBe(true);
  }

  expect(touchesSensitivePath("lib/changesets/confirmation.ts")).toBe(false);
  expect(touchesSensitivePath("docs/config.md")).toBe(true);
});

test("a suggestion nobody reviewed asks first", () => {
  expect(needsConfirmation({ ...CLEAN, reviewed_at: null }, CLEAN.base_sha)).toBe(true);
});

test("a standing approval stands in for the review, not for the other reasons", () => {
  const unreviewed = { ...CLEAN, reviewed_at: null };

  expect(needsConfirmation(withStandingApproval(unreviewed, true), CLEAN.base_sha)).toBe(
    false
  );
  expect(needsConfirmation(withStandingApproval(unreviewed, false), CLEAN.base_sha)).toBe(
    true
  );

  // Configuration and a moved head are facts the standing approval never saw.
  expect(
    needsConfirmation(
      withStandingApproval({ ...unreviewed, files: [{ path: "package.json" }] }, true),
      CLEAN.base_sha
    )
  ).toBe(true);
  expect(
    needsConfirmation(withStandingApproval(unreviewed, true), "b".repeat(40))
  ).toBe(true);
});

// ── The two decisions that never write ───────────────────────────────────────

type Patch = Record<string, unknown>;

function fakeDatabase(data: unknown) {
  const state: { patch: Patch | null } = { patch: null };

  const chain = {
    from: () => chain,
    update: (patch: Patch) => {
      state.patch = patch;
      return chain;
    },
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    maybeSingle: async () => ({ data, error: null }),
  };

  return { chain, state };
}

function noNetwork() {
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("the review path must not reach GitHub");
  }) as unknown as typeof fetch;

  return () => calls;
}

test("markReviewed records the review, keeps the status, and never calls GitHub", async () => {
  const fetches = noNetwork();
  const { chain, state } = fakeDatabase({ reviewed_at: "2026-11-09T00:00:00.000Z" });

  const result = await markChangesetReviewed(chain as never, {
    changesetId: "changeset-1",
    owner: "owner-1",
  });

  expect(result.ok).toBe(true);
  expect(fetches()).toBe(0);
  expect(state.patch).toEqual({ reviewed_at: expect.any(String) });
  expect(state.patch).not.toHaveProperty("status");
});

test("rejectChangeset discards the suggestion and never calls GitHub", async () => {
  const fetches = noNetwork();
  const { chain, state } = fakeDatabase({ id: "changeset-1" });

  const result = await rejectChangeset(chain as never, {
    changesetId: "changeset-1",
    owner: "owner-1",
  });

  expect(result.ok).toBe(true);
  expect(fetches()).toBe(0);
  expect(state.patch).toEqual({ status: "rejected" });
});

// ── Applying ─────────────────────────────────────────────────────────────────

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

const REPLACE_FILE = {
  path: "lib/a.ts",
  mode: "replace" as const,
  original: "const a = 1;\nconst b = 2;\n",
  proposed: "const a = 1;\nconst b = 3;\n",
};

test("a failed re-apply fails the suggestion and never writes to GitHub", async () => {
  const recorded: Patch[] = [];
  let writes = 0;

  const outcome = await runApply({
    repo: "octocat/hello",
    baseSha: "base-1",
    head: "head-2",
    files: [REPLACE_FILE],
    steps: {
      rebase: async () => ({ ok: false, reason: "lib/a.ts changed since the suggestion." }),
      write: async () => {
        writes += 1;
        throw new Error("the write must not run");
      },
    },
    record: async (patch) => {
      recorded.push(patch);
      return { ok: true };
    },
  });

  expect(outcome).toEqual({ ok: false, error: APPLY_CONFLICT_MESSAGE });
  expect(writes).toBe(0);
  expect(recorded).toEqual([
    { status: "failed", merge_commit_sha: null, failure: APPLY_CONFLICT_MESSAGE },
  ]);
});

test("a successful re-apply writes the rebased content with force: false", async () => {
  const calls = stubFetch((method, path) => {
    if (method === "GET" && path.endsWith("/git/ref/heads/main")) {
      return { body: { object: { sha: "head-2" } } };
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
    if (method === "PATCH" && path.endsWith("/git/refs/heads/main")) {
      return { body: { object: { sha: "commit-new" } } };
    }
    return null;
  });

  const recorded: Patch[] = [];

  const outcome = await runApply({
    repo: "octocat/hello",
    baseSha: "base-1",
    head: "head-2",
    files: [REPLACE_FILE],
    steps: {
      rebase: async () => ({
        ok: true,
        files: [
          { path: "lib/a.ts", content: "const a = 1;\nconst b = 3;\nconst c = 4;\n" },
        ],
      }),
      write: (write) =>
        commitProposal({
          token: "sealed-token",
          repo: "octocat/hello",
          defaultBranch: "main",
          baseBranch: "main",
          baseSha: write.baseSha,
          files: write.files,
          changesetId: "changeset-1",
          targetBranch: "main",
          allowDefaultBranch: true,
        }),
    },
    record: async (patch) => {
      recorded.push(patch);
      return { ok: true };
    },
  });

  expect(outcome).toMatchObject({
    ok: true,
    commitSha: "commit-new",
    branch: "main",
    prUrl: null,
    rebased: true,
  });

  const patch = calls.find((call) => call.method === "PATCH");
  expect(patch?.path).toBe("/repos/octocat/hello/git/refs/heads/main");
  expect(patch?.body).toEqual({ sha: "commit-new", force: false });

  const tree = calls.find(
    (call) => call.method === "POST" && call.path.endsWith("/git/trees")
  );
  const entries = tree?.body?.tree as Array<{ path: string; content: string }>;
  expect(entries).toHaveLength(1);
  expect(entries[0].content).toBe("const a = 1;\nconst b = 3;\nconst c = 4;\n");

  expect(recorded.at(-1)).toMatchObject({
    status: "committed",
    commit_sha: "commit-new",
    branch_name: "main",
  });
});

test("a write that fails is reported without claiming the change was applied", async () => {
  const recorded: Patch[] = [];

  const outcome = await runApply({
    repo: "octocat/hello",
    baseSha: "base-1",
    head: "base-1",
    files: [{ ...REPLACE_FILE, mode: "write" as const }],
    steps: {
      rebase: async () => ({ ok: true, files: [] }),
      write: async () => {
        throw new Error("GitHub refused the write.");
      },
    },
    record: async (patch) => {
      recorded.push(patch);
      return { ok: true };
    },
  });

  expect(outcome).toEqual({ ok: false, error: "GitHub refused the write." });
  expect(recorded).toEqual([{ failure: "GitHub refused the write." }]);
  expect(recorded.some((patch) => patch.status === "committed")).toBe(false);
});

// ── The sandbox rebase is read-only ──────────────────────────────────────────

test("the sandbox rebase has no write token and no way to update a ref", () => {
  const source = readFileSync(
    new URL("../lib/sandbox/rebase.ts", import.meta.url),
    "utf8"
  );

  expect(source).not.toContain("git push");
  expect(source).not.toContain("refs/heads");
  expect(source).not.toContain("@/lib/github/write");
  expect(source).not.toContain("force");
  expect(source).toContain("fetchRepoArchive");
  expect(source).toContain("createSandbox");
});

// ── The automatic write path ─────────────────────────────────────────────────

test("the worker proposes a diff, so the card always asks before anything is written", () => {
  const worker = readFileSync(
    new URL("../lib/runs/chat.ts", import.meta.url),
    "utf8"
  );
  const panel = readFileSync(
    new URL("../components/ReviewPanel.tsx", import.meta.url),
    "utf8"
  );

  // The run settles with a signed changeset; the write stays on the card.
  expect(worker).toContain("finalizeChangeset");
  expect(worker).not.toContain("approveChangesetAndOpenPullRequest");

  // Because nothing was written on the reader's behalf, the card must always
  // offer the decision.
  expect(panel).toContain("<ApplyControl");
  expect(panel).not.toContain("autoWrite");
});

// ── The migration ────────────────────────────────────────────────────────────

test("the migration records a review and allows a discarded suggestion", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/031_apply_review.sql", import.meta.url),
    "utf8"
  );

  expect(sql).toContain("add column if not exists reviewed_at timestamptz");
  expect(sql).toContain("'rejected'");
  expect(sql).toContain("changesets_status_check");
});
