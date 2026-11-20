import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync(
  new URL("../supabase/migrations/020_branch_autoapprovals.sql", import.meta.url),
  "utf8"
);
const MODULE = readFileSync(
  new URL("../lib/changesets/autoapproval.ts", import.meta.url),
  "utf8"
);
const ACTIONS = readFileSync(
  new URL("../app/chat/actions.ts", import.meta.url),
  "utf8"
);
const ROUTE = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);
const SWITCH_MIGRATION = readFileSync(
  new URL("../supabase/migrations/021_drop_autopilot.sql", import.meta.url),
  "utf8"
);
// The apply card and its dialog are gone: a turn writes its own change, so a
// standing approval is only ever read by the server, never remembered from a
// click. These assertions now read the actions and the module that own it.

test("a standing approval is owner-scoped in the database", () => {
  expect(MIGRATION).toContain("branch_autoapprovals");
  expect(MIGRATION).toContain("enable row level security");
  expect(MIGRATION).toContain("owner = auth.uid()");
  expect(MIGRATION).toContain("primary key (owner, repo_full_name, branch)");
});

test("a standing approval is remembered by the server, and it can be turned off", () => {
  expect(ACTIONS).toContain("rememberAutoApproval");
  expect(ACTIONS).toContain("forgetBranchAutoApproval");
  expect(MODULE).toContain("readAutoApproval");
});

test("an agent turn ends at the card, where a standing approval can answer for it", () => {
  // The run proposes the diff; nothing in the request or the worker writes.
  expect(ROUTE).not.toContain("approveChangesetAndOpenPullRequest");
  expect(ROUTE).not.toContain("autopilot");

  // The approval itself is unchanged, and it still reads the standing approval.
  expect(ACTIONS).toContain("rememberAutoApproval");
  expect(MODULE).toContain("readAutoApproval");
});

test("the autopilot switch is gone, and its behaviour is the default", () => {
  expect(SWITCH_MIGRATION).toContain("drop column if exists autopilot");
  expect(ACTIONS).not.toContain("autopilot");
});
