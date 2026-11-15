import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  accountCooldownMinutes,
  availableAccounts,
  pickSandboxAccount,
  shouldFailOver,
  type SandboxAccount,
  type SandboxAccountState,
} from "../lib/execution/account-pool";

/**
 * The switching rules.
 *
 * The decision parts — which accounts are eligible, which failures mean "this
 * account" rather than "this request", and how long a full account waits — are
 * pure and run here. The rest is the wiring: that creation is attempted once
 * more elsewhere, that the account it lands on is the one recorded, and that a
 * reader is told when a workspace had to be rebuilt somewhere else.
 */

const read = (path: string) => readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const now = Date.parse("2026-11-15T12:00:00.000Z");

const accounts: SandboxAccount[] = [
  { id: "acct-1", key: "k1" },
  { id: "acct-2", key: "k2" },
  { id: "acct-3", key: "k3" },
];

const state = (
  kind: SandboxAccountState["state"],
  until: string | null = null
): SandboxAccountState => ({ state: kind, setAsideUntil: until });

const ids = (list: SandboxAccount[]) => list.map((account) => account.id);

test("an account nobody has recorded a problem with is usable", () => {
  expect(ids(availableAccounts(accounts, {}))).toEqual(["acct-1", "acct-2", "acct-3"]);
  expect(ids(availableAccounts(accounts, { "acct-2": state("active") }))).toEqual([
    "acct-1",
    "acct-2",
    "acct-3",
  ]);
});

test("a disabled account is out until an operator clears it", () => {
  const states = { "acct-2": state("disabled") };

  expect(ids(availableAccounts(accounts, states))).toEqual(["acct-1", "acct-3"]);
  // No timer brings it back, however far ahead the clock moves.
  expect(
    ids(availableAccounts(accounts, states, Date.parse("2027-11-15T12:00:00.000Z")))
  ).toEqual(["acct-1", "acct-3"]);
});

test("a cooling account is out until its own timer expires", () => {
  const states = { "acct-1": state("cooling", "2026-11-15T12:15:00.000Z") };

  expect(ids(availableAccounts(accounts, states, now))).toEqual(["acct-2", "acct-3"]);
  expect(
    ids(availableAccounts(accounts, states, Date.parse("2026-11-15T12:14:59.000Z")))
  ).toEqual(["acct-2", "acct-3"]);
  expect(
    ids(availableAccounts(accounts, states, Date.parse("2026-11-15T12:15:00.000Z")))
  ).toEqual(["acct-1", "acct-2", "acct-3"]);
});

test("a cooling row with no readable timer stays out", () => {
  // Better to skip an account until someone looks than to retry it on every
  // request because a timestamp could not be parsed.
  expect(ids(availableAccounts(accounts, { "acct-1": state("cooling") }))).toEqual([
    "acct-2",
    "acct-3",
  ]);
  expect(
    ids(availableAccounts(accounts, { "acct-1": state("cooling", "not a date") }))
  ).toEqual(["acct-2", "acct-3"]);
});

test("only a limit or a rejected key moves a box to another account", () => {
  expect(shouldFailOver("quota")).toBe(true);
  expect(shouldFailOver("not_configured")).toBe(true);

  // The same on every account: retrying doubles the wait and teaches nothing.
  expect(shouldFailOver("refused")).toBe(false);
  expect(shouldFailOver("missing")).toBe(false);
});

test("the cooldown has a default and is clamped to something sane", () => {
  expect(accountCooldownMinutes({})).toBe(15);
  expect(accountCooldownMinutes({ E2B_ACCOUNT_COOLDOWN_MINUTES: "" })).toBe(15);
  expect(accountCooldownMinutes({ E2B_ACCOUNT_COOLDOWN_MINUTES: "0" })).toBe(15);
  expect(accountCooldownMinutes({ E2B_ACCOUNT_COOLDOWN_MINUTES: "-3" })).toBe(15);
  expect(accountCooldownMinutes({ E2B_ACCOUNT_COOLDOWN_MINUTES: "5" })).toBe(5);
  expect(accountCooldownMinutes({ E2B_ACCOUNT_COOLDOWN_MINUTES: "99999" })).toBe(1_440);
});

test("a set-aside account is never chosen, whatever the seed", () => {
  const states = { "acct-1": state("disabled") };
  const usable = availableAccounts(accounts, states);

  const chosen = new Set(
    Array.from({ length: 40 }, (_, index) =>
      pickSandboxAccount({ accounts: usable, seed: `chat-${index}` })?.id
    )
  );

  expect(chosen.has("acct-1")).toBe(false);
  expect(chosen).toEqual(new Set(["acct-2", "acct-3"]));
});

test("when everything is set aside, nothing is chosen", () => {
  const states = {
    "acct-1": state("disabled"),
    "acct-2": state("cooling", "2026-11-15T12:15:00.000Z"),
    "acct-3": state("cooling", "2026-11-15T12:15:00.000Z"),
  };

  const usable = availableAccounts(accounts, states, now);

  expect(usable).toEqual([]);
  expect(pickSandboxAccount({ accounts: usable, seed: "chat-a" })).toBeNull();
});

test("creation is tried once more on another account, and the box it lands on is the one recorded", () => {
  const provider = read("/lib/execution/provider.ts");

  // At most two attempts: pinned or switched off means exactly one.
  expect(provider).toContain("const attempts = input.accountId || !failoverEnabled() ? 1 : 2;");
  expect(provider).toContain("shouldFailOver(failure.failure) || attempt + 1 >= attempts");

  // A limit cools; a rejected key is disabled.
  expect(provider).toContain(
    'kind: failure.failure === "quota" ? "cooling" : "disabled"'
  );

  // Both create paths go through the retry, so a chat, a run and a mission all
  // switch the same way.
  expect(provider.match(/await createWithFailover\(\{/g)?.length).toBe(3);

  // The handle names the account that actually holds the box; every caller
  // records `handle.accountId`, which is the id from this attempt, not the one
  // the first attempt wanted.
  expect(provider).toContain("accountId: account.id");
  expect(provider).toContain("return handleFor(sandbox, sandbox.sandboxId, account);");

  // No capacity is reported as capacity, not as an unconfigured deployment.
  expect(provider).toContain("new SandboxStartError(\"quota\", NO_CAPACITY_MESSAGE)");
});

test("a pool of one keeps its old behaviour and remembers nothing", () => {
  const accounts = read("/lib/execution/accounts.ts");

  // No extra write per creation, and no row a later second account would
  // inherit from a deployment that had nothing to switch to. Every writer of
  // `sandbox_accounts` opts out: set-aside, the try record and the success mark.
  expect(accounts.match(/if \(parseSandboxAccounts\(\)\.length < 2\) return;/g)?.length).toBe(3);
});

test("a workspace that cannot be opened is rebuilt, and the reader is told where it went", () => {
  const open = read("/lib/execution/chat-env/open.ts");

  expect(open).toContain('opened.failure === "missing" ||');
  expect(open).toContain('opened.failure === "not_configured"');
  expect(open).toContain("return provision(input, lease, row.sandboxAccount);");
  expect(open).toContain("replacedFrom && replacedFrom !== handle.accountId");

  // The new row is written with the account of the box that was actually made.
  expect(open).toContain("sandboxAccount: handle.accountId");
});
