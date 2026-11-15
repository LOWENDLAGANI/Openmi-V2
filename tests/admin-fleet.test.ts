import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  agoLabel,
  fleetStatus,
  minutesLeft,
  type SandboxFleetAccount,
} from "../lib/execution/fleet-types";

/**
 * The admin fleet panel.
 *
 * The labels are pure, so the four states an operator has to tell apart — a
 * working account, a ready one, a cooling limit and a key that needs a person —
 * are checked directly. The rest is wiring: that the live view is admin-only,
 * that it refreshes itself, and that the table it reads holds labels and times
 * rather than credentials.
 */

const read = (path: string) => readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const now = Date.parse("2026-11-15T12:00:00.000Z");

const account = (
  overrides: Partial<SandboxFleetAccount> = {}
): SandboxFleetAccount => ({
  id: "acct-1",
  configured: true,
  state: "active",
  setAsideUntil: null,
  lastTriedAt: null,
  lastOkAt: null,
  lastFailure: null,
  lastFailureAt: null,
  live: 0,
  chat: 0,
  runs: 0,
  executions: 0,
  cap: null,
  acceptingNew: true,
  ...overrides,
});

test("an account with live boxes is working", () => {
  const status = fleetStatus(account({ live: 3, chat: 2, runs: 1 }), now);

  expect(status.label).toBe("working");
  expect(status.tone).toBe("ok");
});

test("an idle account that just created a box is still working", () => {
  // The box was destroyed a moment ago; the account itself is fine.
  const status = fleetStatus(
    account({ lastOkAt: new Date(now - 2 * 60_000).toISOString() }),
    now
  );

  expect(status.label).toBe("working");
});

test("an idle account whose last success is old reads as ready, not broken", () => {
  const status = fleetStatus(
    account({ lastOkAt: new Date(now - 3 * 60 * 60_000).toISOString() }),
    now
  );

  expect(status.label).toBe("ready");
  expect(status.tone).toBe("optional");
});

test("a cooling account shows the minutes it has left", () => {
  const status = fleetStatus(
    account({
      state: "cooling",
      setAsideUntil: new Date(now + 4 * 60_000 + 20_000).toISOString(),
      acceptingNew: false,
    }),
    now
  );

  expect(status.label).toBe("cooling 5m");
  expect(status.tone).toBe("pending");
});

test("a cooling timer that has run out reads as usable again", () => {
  const status = fleetStatus(
    account({ state: "cooling", setAsideUntil: new Date(now - 60_000).toISOString() }),
    now
  );

  expect(status.label).toBe("ready");
});

test("a set-aside key is named as one, and is never called ready", () => {
  const status = fleetStatus(
    account({ state: "disabled", acceptingNew: false, lastOkAt: new Date(now).toISOString() }),
    now
  );

  expect(status.label).toBe("set aside");
  expect(status.tone).toBe("missing");
});

test("a label the deployment no longer has is shown as such, not as broken", () => {
  const status = fleetStatus(account({ configured: false, acceptingNew: false }), now);

  expect(status.label).toBe("not configured");
  expect(status.tone).toBe("optional");
});

test("minutes left round up, and unreadable or past times are null", () => {
  expect(minutesLeft(new Date(now + 30_000).toISOString(), now)).toBe(1);
  expect(minutesLeft(new Date(now + 60_000).toISOString(), now)).toBe(1);
  expect(minutesLeft(new Date(now + 61_000).toISOString(), now)).toBe(2);
  expect(minutesLeft(new Date(now - 1).toISOString(), now)).toBeNull();
  expect(minutesLeft(null, now)).toBeNull();
  expect(minutesLeft("not a date", now)).toBeNull();
});

test("ages are coarse enough to read and never negative", () => {
  const ago = (ms: number) => agoLabel(new Date(now - ms).toISOString(), now);

  expect(ago(5_000)).toBe("just now");
  expect(ago(44_000)).toBe("just now");
  expect(ago(5 * 60_000)).toBe("5m ago");
  expect(ago(3 * 3_600_000)).toBe("3h ago");
  expect(ago(50 * 3_600_000)).toBe("2d ago");
  expect(ago(-30_000)).toBe("just now");
  expect(agoLabel(null, now)).toBe("never");
  expect(agoLabel("garbage", now)).toBe("never");
});

test("the live view is admin-only and refreshes itself", () => {
  const route = read("/app/api/admin/status/route.ts");
  const panel = read("/app/admin/SandboxFleet.tsx");
  const page = read("/app/admin/page.tsx");

  // The fleet is read only for a verified admin, next to the counts that were
  // already gated the same way.
  expect(route).toContain("const client = admin ? supabaseAdmin() : null;");
  expect(route).toContain("sandboxFleet(client)");
  expect(route).toContain("fleet,");

  // Rendered on the server, then re-read every few seconds.
  expect(page).toContain("const fleet = await sandboxFleet(admin, Date.now());");
  expect(page).toContain("<SandboxFleet initial={fleet} />");
  expect(panel).toContain('fetch("/api/admin/status"');
  expect(panel).toContain("const POLL_MS = 5_000;");
  expect(panel).toContain("setInterval(() => setNow(Date.now()), 1_000)");
});

test("the fleet is a view of labels and times, not of keys", () => {
  const accounts = read("/lib/execution/accounts.ts");
  const start = accounts.indexOf("export async function sandboxFleet(");
  const body = accounts.slice(start, start + 6_000);

  expect(start).toBeGreaterThan(-1);
  expect(body).toContain('from("sandbox_accounts")');
  expect(body).not.toContain("apiKey");
  // The keys are never selected: the row is a label, a state and timestamps.
  expect(body).not.toContain("account.key");
});
