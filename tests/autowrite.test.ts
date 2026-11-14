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

test("the agent proposes its diff and never writes one from the worker", () => {
  const WORKER = readFileSync(
    new URL("../lib/runs/chat.ts", import.meta.url),
    "utf8"
  );

  // A run ends with a changeset card, not a push. The write is a deliberate act
  // on that card, so there is no automatic path left to guard.
  expect(WORKER).toContain("createChangeset");
  expect(WORKER).toContain("finalizeChangeset");
  expect(WORKER).not.toContain("approveChangesetAndOpenPullRequest");
  expect(ROUTE).not.toContain("approveChangesetAndOpenPullRequest");

  // The card always offers the decision, because nothing wrote on its behalf.
  expect(PANEL).toContain("<ApplyControl");
});

test("the card always offers the apply decision", () => {
  // A ready diff the route declined to write is the card's to resolve, so the
  // panel no longer branches on the auto-write switch.
  expect(PANEL).toContain("<ApplyControl");
  expect(PANEL).not.toContain("autoWrite");
  expect(PANEL).not.toContain("without an approval click");
});
