import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  TRASH_RETENTION_DAYS,
  TRASH_RETENTION_MS,
  trashCutoff,
} from "../lib/trash";

/**
 * Trash has a deadline now. The number is one named constant, the delete is in
 * the sweep that already runs daily, and the trash view prints the same number —
 * so the promise on screen and the deletion cannot drift apart.
 */

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const SWEEP = read("/app/api/cron/sandbox-sweep/route.ts");
const TRASH = read("/components/TrashList.tsx");

test("a trashed chat is due after thirty days", () => {
  expect(TRASH_RETENTION_DAYS).toBe(30);
  expect(TRASH_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);

  const now = Date.parse("2026-11-14T00:00:00.000Z");
  expect(trashCutoff(now)).toBe("2026-10-15T00:00:00.000Z");
});

test("the sweep purges expired trash, and tears the sandbox down first", () => {
  expect(SWEEP).toContain("trashCutoff(now)");
  expect(SWEEP).toContain('pass: "purge"');
  expect(SWEEP).toContain("await wipeChatSandboxes(ids)");

  // The row is the only pointer to a container; deleting it first would orphan
  // the box with nothing left to find it by.
  expect(SWEEP.indexOf("await wipeChatSandboxes(ids)")).toBeLessThan(
    SWEEP.indexOf('.from("chats")\n        .delete()')
  );
});

test("the purge runs even when no sandbox provider is configured", () => {
  // A chat row does not need a container to expire.
  expect(SWEEP.indexOf('pass: "purge"')).toBeLessThan(
    SWEEP.indexOf('skipped: "execution-not-configured"')
  );
});

test("the trash view says how long it keeps things", () => {
  expect(TRASH).toContain("TRASH_RETENTION_DAYS");
  expect(TRASH).toContain("days pass");
});
