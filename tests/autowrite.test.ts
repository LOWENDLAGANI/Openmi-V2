import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import {
  autoWriteEnabled,
  defaultBranchWritesAllowed,
} from "../lib/github/autowrite";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const WORKER = read("lib/runs/loop.ts");
const PROPOSAL = read("lib/runs/chat.ts");
const ROUTE = read("app/api/chat/route.ts");

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
    expect(defaultBranchWritesAllowed({ OPENMI_ALLOW_DEFAULT_BRANCH: on })).toBe(
      true
    );
  }

  for (const off of ["off", "0", "no", ""]) {
    expect(defaultBranchWritesAllowed({ OPENMI_ALLOW_DEFAULT_BRANCH: off })).toBe(
      false
    );
  }
});

test("a finished turn writes its change without a click", () => {
  // The proposal layer still only proposes. The write happens once, from the run
  // that produced the signed changeset.
  expect(PROPOSAL).toContain("createChangeset");
  expect(PROPOSAL).toContain("finalizeChangeset");
  expect(PROPOSAL).not.toContain("approveChangesetAndOpenPullRequest");

  expect(WORKER).toContain("approveChangesetAndOpenPullRequest");
  expect(WORKER).toContain("autoWriteEnabled()");
  // A refused or cancelled turn writes nothing.
  expect(WORKER).toContain('status === "done"');
});

test("the reader learns the outcome from the transcript, not a dialog", () => {
  expect(WORKER).toContain("changeset.applied");
  expect(WORKER).toContain("The change was not written");
  expect(ROUTE).toContain("changeset.applied");
  // The branch and the pull request arrive as a sentence in the conversation.
  expect(ROUTE).toContain('send("notice", { message: summary })');
});

test("no review card or apply dialog stands between the turn and the write", () => {
  // The chat is the interface: a signed change is written when the turn ends,
  // so there is no card to accept and no dialog that asks a second time.
  expect(existsSync(new URL("../components/ReviewPanel.tsx", import.meta.url))).toBe(
    false
  );
  expect(existsSync(new URL("../components/ApplyDialog.tsx", import.meta.url))).toBe(
    false
  );
  expect(existsSync(new URL("../components/ExecutionPanel.tsx", import.meta.url))).toBe(
    false
  );
});
