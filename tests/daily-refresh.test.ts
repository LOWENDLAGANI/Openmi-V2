import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { localDay } from "../lib/credits";
import { callRpc, isMissingFunction, type RpcOutcome } from "../lib/rpc-fallback";

/**
 * The daily allowance is settled by an RPC that migration 053 renamed. Until
 * that migration is pushed the new name does not exist, and the old code
 * swallowed the error — which looks exactly like "the refresh never ran".
 */

const missing = {
  message:
    "Could not find the function public.refill_daily_credit(p_owner) in the schema cache",
  code: "PGRST202",
};

test("a missing function is told apart from a refusal", () => {
  expect(isMissingFunction(missing)).toBe(true);
  expect(isMissingFunction({ message: "function public.x() does not exist" })).toBe(
    true
  );
  // A real answer must not trigger a second call: the old name would not have a
  // different opinion about a closed refund window or a missing row.
  expect(isMissingFunction({ message: "credit: refund window closed" })).toBe(
    false
  );
  expect(isMissingFunction({ message: "permission denied for function" })).toBe(
    false
  );
  expect(isMissingFunction(null)).toBe(false);
});

test("the current name is tried first and the old one only when it is absent", async () => {
  const calls: string[] = [];

  const answered = await callRpc<string>(async (name) => {
    calls.push(name);
    if (name === "refill_daily_credit") return { data: null, error: missing };
    return { data: "6", error: null } as RpcOutcome<string>;
  }, ["refill_daily_credit", "refill_daily_dew"]);

  expect(answered.data).toBe("6");
  expect(calls).toEqual(["refill_daily_credit", "refill_daily_dew"]);
});

test("a working current name is a single call", async () => {
  const calls: string[] = [];

  const answered = await callRpc<number>(async (name) => {
    calls.push(name);
    return { data: 6, error: null };
  }, ["refill_daily_credit", "refill_daily_dew"]);

  expect(answered.data).toBe(6);
  expect(calls).toEqual(["refill_daily_credit"]);
});

test("a genuine refusal is returned without trying the legacy name", async () => {
  const calls: string[] = [];

  const answered = await callRpc<number>(async (name) => {
    calls.push(name);
    return { data: null, error: { message: "credit: no profile" } };
  }, ["refill_daily_credit", "refill_daily_dew"]);

  expect(answered.error?.message).toBe("credit: no profile");
  expect(calls).toEqual(["refill_daily_credit"]);
});

test("the refill asks for both names and the page reads the settled day", () => {
  const STORE = readFileSync(
    new URL("../lib/credits/store.ts", import.meta.url),
    "utf8"
  );

  // Pre-rename function, kept only as the fallback for an un-migrated database.
  expect(STORE).toContain("refill_daily_dew");
  expect(STORE).toContain("credit_day");
});

test("the refresh date is the member's local date, not UTC", () => {
  const noonUtc = new Date("2026-11-17T12:00:00Z");

  expect(localDay("UTC", noonUtc)).toBe("2026-11-17");
  // +14: it is already the 18th there.
  expect(localDay("Pacific/Kiritimati", noonUtc)).toBe("2026-11-18");
  // -11: it is still the 17th at 01:00.
  expect(localDay("Pacific/Midway", noonUtc)).toBe("2026-11-17");
  // An invalid zone must not throw in a render.
  expect(localDay("Not/AZone", noonUtc)).toBe("2026-11-17");
});

test("the history explains a settled day that added nothing", () => {
  const PAGE = readFileSync(
    new URL("../app/activity/page.tsx", import.meta.url),
    "utf8"
  );

  expect(PAGE).toContain("Daily refresh");
  expect(PAGE).toContain("A refill tops up to the allowance; it does not stack.");
  expect(PAGE).toContain("Credit history");
});
