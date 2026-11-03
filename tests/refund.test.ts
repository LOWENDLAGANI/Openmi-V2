import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { refundReasonFor } from "../lib/dew/refund";

test("a failed turn with no answer is refunded", () => {
  expect(refundReasonFor({ textLength: 0, stopped: "error" })).toContain("provider failed");
  expect(refundReasonFor({ textLength: 0, stopped: "aborted" })).toContain("stopped");
  expect(refundReasonFor({ textLength: 0, stopped: "conflict" })).toContain("could not advance");
  expect(refundReasonFor({ textLength: 0, stopped: "done" })).toContain("empty answer");
  expect(refundReasonFor({ textLength: 0, stopped: "tokens" })).toContain("empty answer");
});

test("a failure is refunded even when part of an answer had arrived", () => {
  expect(refundReasonFor({ textLength: 120, stopped: "error" })).toContain(
    "failed before finishing"
  );
  expect(refundReasonFor({ textLength: 120, stopped: "conflict" })).toContain(
    "could not finish"
  );
});

test("a finished answer, a stop after tokens, a pause or saved steps keep the hour charged", () => {
  expect(refundReasonFor({ textLength: 12, stopped: "done" })).toBeNull();
  expect(refundReasonFor({ textLength: 12, stopped: "aborted" })).toBeNull();
  expect(refundReasonFor({ textLength: 0, stopped: "paused" })).toBeNull();
  expect(refundReasonFor({ textLength: 0, stopped: "steps" })).toBeNull();
});

test("a reason reads as a sentence fragment without a stray full stop", () => {
  for (const stopped of ["error", "aborted", "conflict", "done"]) {
    const reason = refundReasonFor({ textLength: 0, stopped });
    expect(reason).not.toBeNull();
    expect(reason?.endsWith(".")).toBe(false);
    expect(reason?.length).toBeGreaterThan(0);
  }
});

test("both chat paths refund through the shared decision", () => {
  const route = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");

  // One plain completion path and one agent path.
  expect(route.split("refundReasonFor(").length - 1).toBe(2);
  expect(route).not.toContain("result.stopped === \"error\" || result.stopped === \"aborted\"");
});
