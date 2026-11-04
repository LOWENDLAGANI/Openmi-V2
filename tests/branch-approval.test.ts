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
const PANEL = readFileSync(
  new URL("../components/ReviewPanel.tsx", import.meta.url),
  "utf8"
);

test("a standing approval is owner-scoped in the database", () => {
  expect(MIGRATION).toContain("branch_autoapprovals");
  expect(MIGRATION).toContain("enable row level security");
  expect(MIGRATION).toContain("owner = auth.uid()");
  expect(MIGRATION).toContain("primary key (owner, repo_full_name, branch)");
});

test("remembering is a choice on the approval card, and it can be turned off", () => {
  expect(PANEL).toContain('name="remember"');
  expect(PANEL).toContain("don&apos;t ask again");
  expect(ACTIONS).toContain("rememberAutoApproval");
  expect(ACTIONS).toContain("forgetBranchAutoApproval");
  expect(MODULE).toContain("readAutoApproval");
});

test("the chat route writes without asking only when the branch is remembered", () => {
  expect(ROUTE).toContain("readAutoApproval(session.supabase");
  expect(ROUTE).toContain("approveChangesetAndOpenPullRequest");
  expect(ROUTE).not.toContain("autopilot");
});

test("the autopilot switch is gone, and its behaviour is the default", () => {
  expect(SWITCH_MIGRATION).toContain("drop column if exists autopilot");
  expect(PANEL).not.toContain("autopilot");
});
