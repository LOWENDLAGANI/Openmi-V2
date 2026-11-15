import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  destinationFromPrompt,
  planWrite,
} from "../lib/changesets/destination";
import { RUN_TOOL_SPECS, parsePublishDestination } from "../lib/runs/tools";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const AGENT = "openmi/agent/abc";
const DEFAULT = "main";

test("a branch the reader named is honoured when the model declared none", () => {
  // "push to main" is a destination, and answering it with a pull request is
  // answering a question the reader did not ask.
  expect(destinationFromPrompt("push to main", DEFAULT)).toEqual({
    kind: "default-branch",
    branch: null,
  });

  expect(
    destinationFromPrompt("commit straight to the develop branch", DEFAULT)
  ).toEqual({ kind: "new-branch", branch: "develop" });

  // A pull request names its base, so the ordinary destination stands — for the
  // default branch and for any other one a PR sentence happens to name.
  expect(destinationFromPrompt("open a pull request to main", DEFAULT)).toBeNull();
  expect(destinationFromPrompt("open a PR against develop", DEFAULT)).toBeNull();
  expect(destinationFromPrompt("raise a pull-request targeting release/2.0", DEFAULT)).toBeNull();
  // A request that names no branch is not a destination.
  expect(destinationFromPrompt("make the build pass", DEFAULT)).toBeNull();
});

test("the model's destination is validated before it is stored", () => {
  expect(parsePublishDestination({ destination: "default-branch" })).toEqual({
    ok: true,
    destination: { kind: "default-branch", branch: null },
  });

  expect(
    parsePublishDestination({ destination: "new-branch", branch: "feature/x" })
  ).toEqual({
    ok: true,
    destination: { kind: "new-branch", branch: "feature/x" },
  });

  expect(parsePublishDestination({ destination: "pull-request" }).ok).toBe(true);

  // A destination is required, only the three kinds exist, and nothing else may
  // ride along.
  expect(parsePublishDestination(null).ok).toBe(false);
  expect(parsePublishDestination({}).ok).toBe(false);
  expect(parsePublishDestination({ destination: "main" }).ok).toBe(false);
  expect(
    parsePublishDestination({ destination: "new-branch", extra: 1 }).ok
  ).toBe(false);

  // A value that cannot be a ref is refused rather than passed to GitHub.
  for (const branch of ["", "two words", "-flag", "../escape", "a..b", "/abs"]) {
    expect(
      parsePublishDestination({ destination: "new-branch", branch }).ok
    ).toBe(false);
  }
});

test("the tool is advertised with the three destinations", () => {
  const spec = RUN_TOOL_SPECS.find((entry) => entry.name === "publish");

  expect(spec).toBeDefined();
  expect(JSON.stringify(spec?.parameters)).toContain("default-branch");
  expect(JSON.stringify(spec?.parameters)).toContain("pull-request");
});

test("a declared destination becomes the matching write", () => {
  const direct = planWrite({
    destination: { kind: "default-branch" },
    agentBranch: AGENT,
    defaultBranch: DEFAULT,
  });

  expect(direct).toEqual({
    ok: true,
    plan: {
      target: "default-branch",
      branch: DEFAULT,
      targetBranch: DEFAULT,
      allowDefaultBranch: true,
      merge: false,
    },
  });

  const named = planWrite({
    destination: { kind: "new-branch", branch: "feature/x" },
    agentBranch: AGENT,
    defaultBranch: DEFAULT,
  });

  expect(named.ok && named.plan.targetBranch).toBe("feature/x");
  expect(named.ok && named.plan.merge).toBe(false);
  expect(named.ok && named.plan.allowDefaultBranch).toBe(false);

  // No name means a derived agent branch of its own.
  const unnamed = planWrite({
    destination: { kind: "new-branch" },
    agentBranch: AGENT,
    defaultBranch: DEFAULT,
  });
  expect(unnamed.ok && unnamed.plan.branch).toBe(AGENT);

  // A pull request is a head branch and an open PR, not a merge.
  const pr = planWrite({
    destination: { kind: "pull-request" },
    agentBranch: AGENT,
    defaultBranch: DEFAULT,
  });
  expect(pr.ok && pr.plan.targetBranch).toBeUndefined();
  expect(pr.ok && pr.plan.merge).toBe(false);

  // Nothing said keeps the ordinary applied write.
  const auto = planWrite({
    destination: null,
    agentBranch: AGENT,
    defaultBranch: DEFAULT,
  });
  expect(auto.ok && auto.plan.merge).toBe(true);
  expect(auto.ok && auto.plan.branch).toBe(AGENT);
});

test("a new branch cannot silently be the default branch", () => {
  const wrong = planWrite({
    destination: { kind: "new-branch", branch: DEFAULT },
    agentBranch: AGENT,
    defaultBranch: DEFAULT,
  });

  expect(wrong.ok).toBe(false);
});

test("the run carries the model's choice into the write", () => {
  const loop = read("lib/runs/loop.ts");
  expect(loop).toContain("result.publish");
  expect(loop).toContain("destination: publishDestination");

  const commit = read("lib/changesets/commit.ts");
  expect(commit).toContain("planWrite(");
  // Only a destination that asked for a merge merges.
  expect(commit).toContain("if (merge && outcome.prUrl");

  const panel = read("components/ReviewPanel.tsx");
  expect(panel).toContain("Pull request open");
});
