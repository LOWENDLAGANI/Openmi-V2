import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { autoWriteEnabled } from "../lib/github/autowrite";

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

test("the chat route writes a ready diff without asking when auto-write is on", () => {
  expect(ROUTE).toContain("autoWriteEnabled");
  expect(ROUTE).toContain("if (autoWrite || remembered)");
  // The standing approval is still read, so turning auto-write off keeps it.
  expect(ROUTE).toContain("readAutoApproval(session.supabase");
});

test("the card reports the write instead of asking when auto-write is on", () => {
  expect(PANEL).toContain("autoWrite");
  expect(PANEL).toContain('{status === "ready" && !autoWrite && (');
  expect(PANEL).toContain("without an approval click");
});
