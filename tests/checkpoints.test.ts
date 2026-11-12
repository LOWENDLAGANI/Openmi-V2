import { expect, test } from "bun:test";

import {
  CHECKPOINT_MAX_LABEL_CHARS,
  changedFileCount,
  checkpointsEnabled,
  defaultCheckpointLabel,
  isCheckpointSha,
  shaFromOutput,
} from "../lib/execution/checkpoints/plan";

/**
 * The rules a version is built on.
 *
 * The sha check is not a formatting preference: the value is interpolated into
 * a git command, so anything that is not a commit hash must never reach a shell.
 * The rest pins the two labels the panel shows, and the switch that decides
 * whether the surface exists at all.
 */

test("only a commit sha is accepted, and it never carries shell syntax", () => {
  expect(isCheckpointSha("a1b2c3d")).toBe(true);
  expect(isCheckpointSha("0123456789abcdef0123456789abcdef01234567")).toBe(true);

  for (const value of [
    "a1b2c3",
    "A1B2C3D",
    "HEAD",
    "main",
    "",
    "a1b2c3d; rm -rf /",
    "a1b2c3d && git push",
    null,
    42,
  ]) {
    expect(isCheckpointSha(value)).toBe(false);
  }
});

test("changed files are counted from porcelain, blank lines ignored", () => {
  expect(changedFileCount("")).toBe(0);
  expect(changedFileCount("\n  \n")).toBe(0);
  expect(changedFileCount(" M app/page.tsx\n?? lib/new.ts\n")).toBe(2);
  expect(changedFileCount("M  a\nA  b\nD  c\n")).toBe(3);
});

test("the sha is the last sha in the output, not the first line", () => {
  const output = [
    "[openmi/work/chat-1 0f1e2d3] 2026-11-12 14:03 UTC",
    " 2 files changed, 10 insertions(+), 2 deletions(-)",
    "0f1e2d3a4b5c6d7e8f901234567890abcdef1234",
  ].join("\n");

  expect(shaFromOutput(output)).toBe(
    "0f1e2d3a4b5c6d7e8f901234567890abcdef1234"
  );
  expect(shaFromOutput("fatal: not a git repository")).toBeNull();
  expect(shaFromOutput("")).toBeNull();
});

test("a default label is a fixed-width UTC timestamp", () => {
  const label = defaultCheckpointLabel(Date.UTC(2026, 10, 12, 14, 3));

  expect(label).toBe("2026-11-12 14:03 UTC");
  expect(label.length).toBeLessThanOrEqual(CHECKPOINT_MAX_LABEL_CHARS);
});

test("versions exist only where a workspace can exist", () => {
  expect(checkpointsEnabled({})).toBe(false);
  expect(checkpointsEnabled({ OPENMI_CHECKPOINTS: "on" })).toBe(false);

  const configured = { E2B_API_KEY: "k" };
  expect(checkpointsEnabled(configured)).toBe(true);

  for (const off of ["off", "false", "0", "OFF"]) {
    expect(checkpointsEnabled({ ...configured, OPENMI_CHECKPOINTS: off })).toBe(
      false
    );
  }

  expect(
    checkpointsEnabled({ ...configured, EXECUTION_ENABLED: "off" })
  ).toBe(false);
});
