import { expect, test } from "bun:test";

import { readFileSync } from "node:fs";

/**
 * Source contracts for the resolver.
 *
 * These assert order, not behaviour: the interesting failures here are
 * accidental ones (seeding before the row is recorded, destroying on release,
 * starting a box without claiming the lease) and each of them is visible as a
 * position or an absence in the file. The decision table itself is tested by
 * execution in `chat-env.test.ts`.
 */

const open = readFileSync("lib/execution/chat-env/open.ts", "utf8");
const store = readFileSync("lib/execution/chat-env/store.ts", "utf8");
const seed = readFileSync("lib/execution/chat-env/seed.ts", "utf8");

function at(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle);
  expect(index).toBeGreaterThan(-1);
  return index;
}

test("a new box is recorded before it is seeded", () => {
  const provision = open.slice(at(open, "async function provision("), at(open, "async function resume("));

  expect(at(provision, "insertChatSandbox")).toBeLessThan(
    at(provision, "seedChatWorkspace")
  );
  expect(at(provision, "createChatSandbox")).toBeLessThan(
    at(provision, "insertChatSandbox")
  );

  // A seed failure destroys the box and forgets the row rather than leaving a
  // row that points at a half-built workspace.
  const failure = provision.slice(at(provision, "if (!seeded.ok)"));
  expect(at(failure, "safeDestroy")).toBeLessThan(at(failure, "deleteChatSandboxRow"));
});

test("a turn claims the lease before it attaches or starts", () => {
  const resume = open.slice(at(open, "async function resume("), at(open, "export async function openChatSandbox("));

  expect(at(resume, "claimChatSandbox")).toBeLessThan(at(resume, "attachSandbox"));
  expect(at(resume, "claimChatSandbox")).toBeLessThan(at(resume, "handle.start"));

  // No claim means another turn owns the box; the resolver must return, not
  // fall through to creating a second environment.
  const noClaim = resume.slice(at(resume, "if (!claimed)"));
  expect(noClaim.slice(0, 200)).toContain("return");
});

test("releasing a turn never destroys the workspace", () => {
  const release = open.slice(at(open, "export async function releaseChatSandbox("));

  expect(release).not.toContain("destroy");
  expect(release).toContain("releaseChatSandboxRow");
  expect(release).toContain("refreshTtl");
});

test("the resolver retires a stale row before provisioning its replacement", () => {
  const resolver = open.slice(at(open, "export async function openChatSandbox("));

  expect(at(resolver, "decideChatSandboxOpen")).toBeLessThan(at(resolver, "provision("));
  expect(at(resolver, "retireRow")).toBeLessThan(at(resolver, "return provision("));
  expect(resolver).toContain("opened.failure === \"missing\"");
});

test("the store owns the lifecycle columns and claims leases conditionally", () => {
  for (const column of [
    "chat_id",
    "sandbox_id",
    "state",
    "repo_full_name",
    "base_sha",
    "workspace_seeded_at",
    "last_active_at",
    "lease_until",
    "delete_after",
    "wipe_attempts",
  ]) {
    expect(store).toContain(column);
  }

  expect(store).toContain('or(`lease_until.is.null,lease_until.lt.');
  expect(store).not.toContain("service_role");
});

test("the seed writes a marker outside the workspace and refuses a missing one", () => {
  expect(seed).toContain(".openmi/env.json");
  expect(seed).toContain("fetchRepoArchive");
  expect(seed).toContain("test -d ${MISSION_WORKDIR}/.git");
  expect(seed).toContain("-name '.env*'");
});
