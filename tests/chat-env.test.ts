import { expect, test } from "bun:test";

import {
  CHAT_SANDBOX_DEFAULT_IDLE_MINUTES,
  CHAT_SANDBOX_DEFAULT_MAX_PER_OWNER,
  CHAT_SANDBOX_DEFAULT_TTL_HOURS,
  CHAT_SANDBOX_LEASE_MS,
  CHAT_SANDBOX_PROVISION_ORPHAN_MS,
  CHAT_SANDBOX_TTL_SLACK_MINUTES,
  chatSandboxArchiveHours,
  chatSandboxIdleMinutes,
  chatSandboxMaxPerOwner,
  chatSandboxTtlHours,
  chatSandboxTtlMinutes,
  chatSandboxesEnabled,
  deleteAfter,
  evictionsForNew,
  isLeaseLive,
  isProvisioningOrphan,
  leaseUntil,
  needsReseed,
  pinMatches,
  shouldStop,
  shouldWipe,
} from "../lib/execution/chat-env/lifecycle";

const T0 = Date.parse("2026-11-05T00:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const iso = (ms: number) => new Date(ms).toISOString();

type Row = Parameters<typeof shouldStop>[0];

function row(patch: Partial<Row> = {}): Row {
  return {
    state: "running",
    lastActiveAt: iso(T0),
    deleteAfter: iso(T0 + 48 * HOUR),
    leaseUntil: null,
    ...patch,
  };
}

type Evictable = { chatId: string | null; lastActiveAt: string };

function env(overrides: Record<string, string> = {}) {
  return { ...overrides };
}

test("the defaults are the product promise: 5 minutes idle, 48 hours to live", () => {
  expect(CHAT_SANDBOX_DEFAULT_IDLE_MINUTES).toBe(5);
  expect(CHAT_SANDBOX_DEFAULT_TTL_HOURS).toBe(48);
  expect(CHAT_SANDBOX_DEFAULT_MAX_PER_OWNER).toBe(3);

  expect(chatSandboxIdleMinutes(env())).toBe(5);
  expect(chatSandboxTtlHours(env())).toBe(48);
  expect(chatSandboxTtlMinutes(env())).toBe(48 * 60 + CHAT_SANDBOX_TTL_SLACK_MINUTES);
  expect(chatSandboxArchiveHours(env())).toBe(0);
  expect(chatSandboxMaxPerOwner(env())).toBe(3);
  expect(chatSandboxesEnabled(env())).toBe(true);
});

test("the idle stop has a kill switch, not a second enablement rule", () => {
  for (const value of ["off", "false", "0", " OFF "]) {
    expect(chatSandboxesEnabled(env({ CHAT_SANDBOX_ENABLED: value }))).toBe(false);
  }

  expect(chatSandboxesEnabled(env({ CHAT_SANDBOX_ENABLED: "on" }))).toBe(true);
});

test("a mis-set environment is clamped, never allowed to buy an hour", () => {
  expect(chatSandboxIdleMinutes(env({ CHAT_SANDBOX_IDLE_MINUTES: "0" }))).toBe(1);
  expect(chatSandboxIdleMinutes(env({ CHAT_SANDBOX_IDLE_MINUTES: "999" }))).toBe(60);
  expect(chatSandboxIdleMinutes(env({ CHAT_SANDBOX_IDLE_MINUTES: "nope" }))).toBe(5);

  expect(chatSandboxTtlHours(env({ CHAT_SANDBOX_TTL_HOURS: "0" }))).toBe(1);
  expect(chatSandboxTtlHours(env({ CHAT_SANDBOX_TTL_HOURS: "9999" }))).toBe(168);
  expect(chatSandboxTtlHours(env({ CHAT_SANDBOX_TTL_HOURS: "-4" }))).toBe(1);

  expect(chatSandboxArchiveHours(env({ CHAT_SANDBOX_ARCHIVE_HOURS: "-5" }))).toBe(0);
  expect(chatSandboxArchiveHours(env({ CHAT_SANDBOX_ARCHIVE_HOURS: "24" }))).toBe(24);

  expect(chatSandboxMaxPerOwner(env({ CHAT_SANDBOX_MAX_PER_OWNER: "0" }))).toBe(1);
  expect(chatSandboxMaxPerOwner(env({ CHAT_SANDBOX_MAX_PER_OWNER: "99" }))).toBe(10);
});

test("the deadline is measured from the last activity, not from creation", () => {
  expect(deleteAfter(T0, 48)).toBe("2026-11-07T00:00:00.000Z");
  expect(deleteAfter(iso(T0), 48)).toBe("2026-11-07T00:00:00.000Z");
  expect(deleteAfter(T0, 1)).toBe("2026-11-05T01:00:00.000Z");

  // An activity at hour 47 moves the wipe to hour 95. This is the property a
  // wall-clock TTL at creation would have broken.
  const later = T0 + 47 * HOUR;
  expect(deleteAfter(later, 48)).toBe(iso(later + 48 * HOUR));
});

test("a malformed timestamp is an error, not a wipe in 1970", () => {
  expect(() => deleteAfter("not a date", 48)).toThrow();
  expect(() => deleteAfter("", 48)).toThrow();
});

test("a lease is live strictly before its deadline and dead at it", () => {
  expect(isLeaseLive(iso(T0 + 1), T0)).toBe(true);
  expect(isLeaseLive(iso(T0), T0)).toBe(false);
  expect(isLeaseLive(iso(T0 - 1), T0)).toBe(false);
  expect(isLeaseLive(null, T0)).toBe(false);
  expect(isLeaseLive("garbage", T0)).toBe(false);

  expect(leaseUntil(T0, MINUTE)).toBe(iso(T0 + MINUTE));
  expect(leaseUntil(T0)).toBe(iso(T0 + CHAT_SANDBOX_LEASE_MS));
});

test("stop happens after the idle window, and only for a running, unleased box", () => {
  const idle = 5;

  expect(shouldStop(row(), T0 + 5 * MINUTE - 1, idle)).toBe(false);
  expect(shouldStop(row(), T0 + 5 * MINUTE, idle)).toBe(true);

  expect(shouldStop(row({ state: "stopped" }), T0 + 30 * MINUTE, idle)).toBe(false);
  expect(shouldStop(row({ state: "archived" }), T0 + 30 * MINUTE, idle)).toBe(false);
  expect(shouldStop(row({ state: "failed" }), T0 + 30 * MINUTE, idle)).toBe(false);

  // A live turn holds the box; the sweep must not stop it underneath.
  expect(
    shouldStop(row({ leaseUntil: iso(T0 + 10 * MINUTE) }), T0 + 6 * MINUTE, idle)
  ).toBe(false);

  // An unreadable last-active is not evidence of idleness.
  expect(shouldStop(row({ lastActiveAt: "not a date" }), T0 + 30 * MINUTE, idle)).toBe(false);
});

test("the wipe lands at 48 hours and is blocked by a live turn", () => {
  const due = T0 + 48 * HOUR;

  expect(shouldWipe(row({ deleteAfter: iso(due) }), due - 1)).toBe(false);
  expect(shouldWipe(row({ deleteAfter: iso(due) }), due)).toBe(true);

  expect(
    shouldWipe(row({ deleteAfter: iso(due), leaseUntil: iso(due + MINUTE) }), due)
  ).toBe(false);

  // A failed provider delete stays due, so the next sweep retries it rather
  // than forgetting a container that is still billing.
  expect(shouldWipe({ deleteAfter: iso(due), leaseUntil: null }, due + HOUR)).toBe(true);

  expect(shouldWipe({ deleteAfter: "not a date", leaseUntil: null }, due)).toBe(false);
});

test("a provisioning row dies with the turn that never released it", () => {
  const createdAt = iso(T0);
  const base = { state: "provisioning" as const, createdAt, leaseUntil: null };
  const after = T0 + CHAT_SANDBOX_PROVISION_ORPHAN_MS;

  expect(isProvisioningOrphan(base, after - 1)).toBe(false);
  expect(isProvisioningOrphan(base, after)).toBe(true);

  expect(isProvisioningOrphan({ ...base, state: "running" }, after)).toBe(false);
  expect(
    isProvisioningOrphan({ ...base, leaseUntil: iso(after + MINUTE) }, after)
  ).toBe(false);
});

test("a different repository or commit is a reseed, not a reuse", () => {
  const seeded = { repoFullName: "OpenMI/V2", baseSha: "a".repeat(40) };

  expect(pinMatches(seeded, "openmi/v2", "A".repeat(40))).toBe(true);
  expect(needsReseed(seeded, "openmi/v2", "b".repeat(40))).toBe(true);
  expect(needsReseed(seeded, "other/repo", "a".repeat(40))).toBe(true);
  expect(needsReseed(seeded, "openmi/v2", "a".repeat(40))).toBe(false);
});

test("the cap evicts the oldest and makes room for the new chat", () => {
  const rows: Evictable[] = [
    { chatId: "a", lastActiveAt: iso(T0) },
    { chatId: "b", lastActiveAt: iso(T0 + 1_000) },
    { chatId: "c", lastActiveAt: iso(T0 + 2_000) },
  ];

  // Two rows and a cap of three has room for one more.
  expect(evictionsForNew(rows.slice(0, 2), 3)).toEqual([]);

  // Three rows and a cap of three leaves no room for a fourth: the oldest goes.
  expect(evictionsForNew(rows, 3).map((row) => row.chatId)).toEqual(["a"]);
  expect(evictionsForNew(rows, 2).map((row) => row.chatId)).toEqual(["a", "b"]);
  expect(evictionsForNew(rows, 1).map((row) => row.chatId)).toEqual([
    "a",
    "b",
    "c",
  ]);
});

test("five environments and a cap of three evict three, not five", () => {
  const rows: Evictable[] = Array.from({ length: 5 }, (_, index) => ({
    chatId: `chat-${index}`,
    lastActiveAt: iso(T0 + index * 1_000),
  }));

  const evicted = evictionsForNew(rows, 3);

  expect(evicted.map((row) => row.chatId)).toEqual(["chat-0", "chat-1", "chat-2"]);
  expect(rows.length - evicted.length + 1).toBe(3);
});

test("the chat being opened is never evicted by its own resolver", () => {
  const rows: Evictable[] = [
    { chatId: "old", lastActiveAt: iso(T0) },
    { chatId: "current", lastActiveAt: iso(T0 + 10_000) },
    { chatId: "newer", lastActiveAt: iso(T0 + 20_000) },
  ];

  expect(evictionsForNew(rows, 2, "current").map((row) => row.chatId)).toEqual(["old"]);
  expect(evictionsForNew(rows, 3, "current")).toEqual([]);
});

test("an orphan row with no chat still counts against the cap", () => {
  const rows: Evictable[] = [
    { chatId: null, lastActiveAt: iso(T0) },
    { chatId: "live", lastActiveAt: iso(T0 + 10_000) },
  ];

  expect(evictionsForNew(rows, 2).map((row) => row.chatId)).toEqual([null]);
});

test("the provider TTL is the wipe deadline plus slack", () => {
  expect(chatSandboxTtlMinutes(env({ CHAT_SANDBOX_TTL_HOURS: "48" }))).toBe(
    48 * 60 + CHAT_SANDBOX_TTL_SLACK_MINUTES
  );
  expect(chatSandboxTtlMinutes(env({ CHAT_SANDBOX_TTL_HOURS: "1" }))).toBe(
    60 + CHAT_SANDBOX_TTL_SLACK_MINUTES
  );
});
