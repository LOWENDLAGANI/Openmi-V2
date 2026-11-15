import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  LEGACY_SANDBOX_ACCOUNT,
  accountById,
  accountsConfigured,
  parseSandboxAccounts,
  pickSandboxAccount,
  recordedAccountId,
  sandboxAccountCap,
} from "../lib/execution/account-pool";

/**
 * The account pool, tested by execution where it can be and by source where it
 * cannot.
 *
 * The parsing and the selection rule are pure, so they are exercised directly.
 * The parts that matter and cannot run here — that the account is written next
 * to every sandbox id, and that no call can reach E2B with an ambient key — are
 * asserted as positions and absences in the files that own them.
 */

const read = (path: string) => readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

function at(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle);
  expect(index).toBeGreaterThan(-1);
  return index;
}

test("one key still works and is labelled default", () => {
  const accounts = parseSandboxAccounts({ E2B_API_KEY: "  e2b_single  " });

  expect(accounts).toEqual([{ id: LEGACY_SANDBOX_ACCOUNT, key: "e2b_single" }]);
  expect(accountsConfigured({ E2B_API_KEY: "e2b_single" })).toBe(true);
  expect(accountsConfigured({})).toBe(false);
  expect(accountsConfigured({ E2B_API_KEY: "   ", E2B_ACCOUNTS: "" })).toBe(false);
});

test("a list is parsed, trimmed and lower-cased", () => {
  const accounts = parseSandboxAccounts({
    E2B_ACCOUNTS: " Acct-1 : e2b_aaa ,\n acct-2:e2b_bbb ",
  });

  expect(accounts).toEqual([
    { id: "acct-1", key: "e2b_aaa" },
    { id: "acct-2", key: "e2b_bbb" },
  ]);
});

test("both forms together are allowed, and a duplicate label keeps the first", () => {
  const accounts = parseSandboxAccounts({
    E2B_ACCOUNTS: "acct-1:e2b_first,default:e2b_from_list,acct-1:e2b_ignored",
    E2B_API_KEY: "e2b_legacy",
  });

  expect(accounts.map((account) => account.id)).toEqual(["acct-1", "default"]);
  expect(accounts[0]?.key).toBe("e2b_first");
  expect(accounts[1]?.key).toBe("e2b_from_list");
});

test("a malformed entry cannot disable the key that is still configured", () => {
  // No colon, an empty key, a label that is not a slug, a fragment of a key
  // used as a label: all skipped.
  const accounts = parseSandboxAccounts({
    E2B_ACCOUNTS: "nocolon,acct-2:,e2b_aaa:key,Acct 3:key,:key",
    E2B_API_KEY: "e2b_legacy",
  });

  expect(accounts.map((account) => account.id)).toEqual(["e2b_aaa", "default"]);
  expect(accountsConfigured({ E2B_ACCOUNTS: "nocolon" })).toBe(false);
});

test("a recorded label is resolved case-insensitively, and an unknown one is null", () => {
  const env = { E2B_ACCOUNTS: "acct-1:e2b_aaa", E2B_API_KEY: "e2b_legacy" };

  expect(accountById("acct-1", env)?.key).toBe("e2b_aaa");
  expect(accountById("ACCT-1", env)?.key).toBe("e2b_aaa");
  expect(accountById("default", env)?.key).toBe("e2b_legacy");
  expect(accountById("acct-9", env)).toBeNull();
  expect(accountById(null, env)).toBeNull();
});

test("the cap is optional, clamped, and never zero", () => {
  expect(sandboxAccountCap({})).toBeNull();
  expect(sandboxAccountCap({ E2B_ACCOUNT_MAX_SANDBOXES: "" })).toBeNull();
  expect(sandboxAccountCap({ E2B_ACCOUNT_MAX_SANDBOXES: "0" })).toBeNull();
  expect(sandboxAccountCap({ E2B_ACCOUNT_MAX_SANDBOXES: "-4" })).toBeNull();
  expect(sandboxAccountCap({ E2B_ACCOUNT_MAX_SANDBOXES: "3" })).toBe(3);
  expect(sandboxAccountCap({ E2B_ACCOUNT_MAX_SANDBOXES: "99999" })).toBe(1_000);
});

const three = [
  { id: "acct-1", key: "k1" },
  { id: "acct-2", key: "k2" },
  { id: "acct-3", key: "k3" },
];

test("the least-loaded account is chosen", () => {
  const chosen = pickSandboxAccount({
    accounts: three,
    load: { "acct-1": 4, "acct-2": 1, "acct-3": 2 },
    seed: "chat-a",
  });

  expect(chosen?.id).toBe("acct-2");
});

test("an account at its cap is skipped while another has room", () => {
  const chosen = pickSandboxAccount({
    accounts: three,
    load: { "acct-1": 3, "acct-2": 0, "acct-3": 3 },
    cap: 3,
    seed: "chat-a",
  });

  expect(chosen?.id).toBe("acct-2");
});

test("when every account is at its cap, one is still chosen", () => {
  const chosen = pickSandboxAccount({
    accounts: three,
    load: { "acct-1": 3, "acct-2": 3, "acct-3": 3 },
    cap: 3,
    seed: "chat-a",
  });

  expect(chosen).not.toBeNull();
});

test("an idle tie is settled by the seed, stably, and still spreads", () => {
  const of = (seed: string) =>
    pickSandboxAccount({ accounts: three, load: {}, seed })?.id;

  // Same workspace, same account — a rebuild lands where the last one was.
  expect(of("chat-a")).toBe(of("chat-a"));
  expect(of("chat-b")).toBe(of("chat-b"));

  // Different workspaces are not all sent to the same account.
  const spread = new Set(
    Array.from({ length: 40 }, (_, index) => of(`chat-${index}`))
  );
  expect(spread.size).toBe(3);
});

test("no accounts means no choice", () => {
  expect(pickSandboxAccount({ accounts: [], seed: "x" })).toBeNull();
});

test("an old row without a label reads as the legacy account", () => {
  expect(recordedAccountId(null)).toBe(LEGACY_SANDBOX_ACCOUNT);
  expect(recordedAccountId(undefined)).toBe(LEGACY_SANDBOX_ACCOUNT);
  expect(recordedAccountId("   ")).toBe(LEGACY_SANDBOX_ACCOUNT);
  expect(recordedAccountId(" Acct-1 ")).toBe("acct-1");
});

test("every stored sandbox id is written next to the account that can open it", () => {
  const open = read("/lib/execution/chat-env/open.ts");
  const store = read("/lib/execution/chat-env/store.ts");
  const runs = read("/lib/runs/loop.ts");
  const worker = read("/lib/runs/worker.ts");

  // A new chat workspace records the account the handle came from, before the
  // row exists — the id alone is not addressable.
  expect(at(open, "sandboxAccount: handle.accountId")).toBeLessThan(
    at(open, "const seeded = await seedChatWorkspace")
  );
  expect(store).toContain("sandbox_account: input.sandboxAccount");

  // Attaching, stopping and destroying all use the row's account.
  expect(open).toContain("attachSandbox(claimed.sandboxId, claimed.sandboxAccount)");
  expect(open).toContain("attachSandbox(row.sandboxId, row.sandboxAccount)");

  // A run records both halves in the same write.
  expect(runs).toContain("sandbox_account: sandbox.accountId");

  // The sweep lists every account and destroys with the one that listed the box.
  expect(worker).toContain("listRunSandboxesEveryAccount(");
  expect(worker).toContain("destroySandboxConfirmed(box.id, box.account)");
});

test("the provider has no ambient key, so a box cannot be opened with the wrong one", () => {
  const provider = read("/lib/execution/provider.ts");

  expect(provider).not.toContain("function clientOptions()");
  expect(provider).toContain("function clientOptionsFor(account: SandboxAccount)");
  expect(provider).toContain("export async function attachSandbox(\n  sandboxId: string,\n  accountId: string\n)");
  expect(provider).toContain("accountId: account.id");

  // An unknown account is reported as missing, so a chat is rebuilt rather than
  // retried forever against a key that was rotated out.
  expect(provider).toContain('SandboxStartError(\n      "missing",');
});
