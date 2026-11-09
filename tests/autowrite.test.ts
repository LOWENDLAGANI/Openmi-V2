import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  autoWriteEnabled,
  defaultBranchWritesAllowed,
} from "../lib/github/autowrite";

const ROUTE = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);
const PANEL = readFileSync(
  new URL("../components/ReviewPanel.tsx", import.meta.url),
  "utf8"
);

test("auto-write is on unless an operator turns it off", () => {
  expect(autoWriteEnabled({})).toBe(true);
  expect(autoWriteEnabled({ OPENMI_AUTO_WRITE: "on" })).toBe(true);
  expect(autoWriteEnabled({ OPENMI_AUTO_WRITE: " yes " })).toBe(true);

  for (const off of ["off", "OFF", "false", "0", "no"]) {
    expect(autoWriteEnabled({ OPENMI_AUTO_WRITE: off })).toBe(false);
  }
});

test("direct default-branch writes are a separate, off-by-default choice", () => {
  expect(defaultBranchWritesAllowed({})).toBe(false);

  for (const on of ["on", "TRUE", "1", "yes"]) {
    expect(defaultBranchWritesAllowed({ OPENMI_ALLOW_DEFAULT_BRANCH: on })).toBe(true);
  }

  for (const off of ["off", "0", "no", ""]) {
    expect(defaultBranchWritesAllowed({ OPENMI_ALLOW_DEFAULT_BRANCH: off })).toBe(false);
  }
});

test("the chat route asks before an automatic write when the change needs it", () => {
  expect(ROUTE).toContain("autoWriteEnabled");
  expect(ROUTE).toContain("if (autoWrite || remembered)");
  expect(ROUTE).toContain("loadConfirmationFacts");
  expect(ROUTE).toContain("needsConfirmation(");
  expect(ROUTE).toContain("withStandingApproval");

  // The question is decided before the write, not after it.
  expect(ROUTE.indexOf("needsConfirmation(")).toBeLessThan(
    ROUTE.indexOf("await approveChangesetAndOpenPullRequest(")
  );

  // The standing approval is still read, so turning auto-write off keeps it.
  expect(ROUTE).toContain("readAutoApproval(session.supabase");
});

test("the card always offers the apply decision", () => {
  // A ready diff the route declined to write is the card's to resolve, so the
  // panel no longer branches on the auto-write switch.
  expect(PANEL).toContain("<ApplyControl");
  expect(PANEL).not.toContain("autoWrite");
  expect(PANEL).not.toContain("without an approval click");
});
