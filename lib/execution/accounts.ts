import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import {
  LEGACY_SANDBOX_ACCOUNT,
  accountCooldownMinutes,
  availableAccounts,
  parseSandboxAccounts,
  pickSandboxAccount,
  sandboxAccountCap,
  type SandboxAccount,
  type SandboxAccountState,
} from "./account-pool";

/**
 * The server half of the E2B account pool: live counts, and the choice for a
 * box that is about to be created.
 *
 * The parsing and the selection rule live in `account-pool.ts` so they can be
 * tested without a database or a provider. This module adds the one thing that
 * needs a connection: how many live boxes each account is holding.
 */

export {
  LEGACY_SANDBOX_ACCOUNT,
  accountById,
  accountCooldownMinutes,
  accountsConfigured,
  availableAccounts,
  parseSandboxAccounts,
  pickSandboxAccount,
  recordedAccountId,
  sandboxAccountCap,
  sandboxAccounts,
  shouldFailOver,
  type SandboxAccount,
  type SandboxAccountState,
} from "./account-pool";

/** States that hold a live box and therefore count against an account. */
const LIVE_CHAT_STATES = ["provisioning", "running", "stopped", "archived", "wiping"];
const LIVE_RUN_STATUSES = ["queued", "running"];
const LIVE_EXECUTION_STATUSES = ["queued", "running", "paused"];

type LoadCache = { at: number; value: Record<string, number> };

let loadCache: LoadCache | null = null;

const LOAD_TTL_MS = 30_000;

type StateCache = { at: number; value: Record<string, SandboxAccountState> };

let stateCache: StateCache | null = null;

/** Short: a set-aside written by this process must be seen by the next pick. */
const STATE_TTL_MS = 5_000;

/** Drops both caches, so a set-aside is visible without waiting for a TTL. */
export function clearSandboxAccountCaches(): void {
  loadCache = null;
  stateCache = null;
}

/**
 * What the fleet remembers about each account, from `sandbox_accounts`.
 *
 * Cached for five seconds: the table is written only when something has just
 * gone wrong, and re-reading it on every provision would put a round trip in
 * front of every new workspace for information that rarely changes.
 */
export async function sandboxAccountStates(
  admin: ReturnType<typeof supabaseAdmin> = supabaseAdmin(),
  now: number = Date.now()
): Promise<Record<string, SandboxAccountState>> {
  if (!admin) return {};
  if (stateCache && now - stateCache.at < STATE_TTL_MS) return stateCache.value;

  const { data } = await admin
    .from("sandbox_accounts")
    .select("id, state, set_aside_until")
    .limit(200);

  const value: Record<string, SandboxAccountState> = {};

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const state = String(row.state ?? "active");
    value[String(row.id)] = {
      state:
        state === "cooling" || state === "disabled" ? state : "active",
      setAsideUntil: row.set_aside_until ? String(row.set_aside_until) : null,
    };
  }

  stateCache = { at: now, value };
  return value;
}

/**
 * Sets an account aside.
 *
 * `cooling` is a full or rate-limited plan: it returns by itself when the
 * window closes. `disabled` is a key the provider rejected or an account that is
 * no longer configured: it waits for an operator, because a dead key does not
 * start working again on a timer.
 *
 * Best effort throughout — a failure to write this must never turn a workspace
 * error into a different error.
 */
export async function setAsideSandboxAccount(input: {
  id: string;
  kind: "cooling" | "disabled";
  reason?: string | null;
  admin?: ReturnType<typeof supabaseAdmin>;
}): Promise<void> {
  // A pool of one has nothing to remember: there is no other account to steer
  // to, so the row would only misreport a healthy key as cooling later.
  if (parseSandboxAccounts().length < 2) return;

  const admin = input.admin ?? supabaseAdmin();
  if (!admin) return;

  const until =
    input.kind === "cooling"
      ? new Date(Date.now() + accountCooldownMinutes() * 60_000).toISOString()
      : null;

  try {
    await admin.from("sandbox_accounts").upsert(
      {
        id: input.id,
        state: input.kind,
        set_aside_until: until,
        last_failure: input.reason ? input.reason.slice(0, 200) : null,
        last_failure_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
  } catch {
    // The workspace error is the one the reader needs to see.
  }

  clearSandboxAccountCaches();
}

/** An account that has just worked is usable again, whatever was remembered. */
export async function markSandboxAccountHealthy(
  id: string,
  admin: ReturnType<typeof supabaseAdmin> = supabaseAdmin()
): Promise<void> {
  // Single-key deployments keep their exact behaviour: no extra write, and no
  // set-aside row that a later second account would inherit.
  if (parseSandboxAccounts().length < 2) return;
  if (!admin) return;

  try {
    await admin
      .from("sandbox_accounts")
      .update({ state: "active", set_aside_until: null })
      .eq("id", id)
      .neq("state", "active");
  } catch {
    // A stale "cooling" row only costs one skipped account for a few minutes.
  }

  clearSandboxAccountCaches();
}

/**
 * Live sandboxes per account label.
 *
 * Read from our own rows rather than the provider's usage API: it needs no
 * second credential, it counts exactly the boxes this deployment can find, and
 * one indexed query is cheaper than a billing round trip on every provision.
 * Cached for thirty seconds in each process — a count that is stale by half a
 * minute is fine for a choice that is also tie-broken by seed.
 */
export async function sandboxAccountLoad(
  admin: ReturnType<typeof supabaseAdmin> = supabaseAdmin(),
  now: number = Date.now()
): Promise<Record<string, number>> {
  if (!admin) return {};

  if (loadCache && now - loadCache.at < LOAD_TTL_MS) return loadCache.value;

  const load: Record<string, number> = {};
  const add = (id: unknown) => {
    const label =
      typeof id === "string" && id.length > 0 ? id : LEGACY_SANDBOX_ACCOUNT;
    load[label] = (load[label] ?? 0) + 1;
  };

  const [chats, runs, executions] = await Promise.all([
    admin
      .from("chat_sandboxes")
      .select("sandbox_account")
      .in("state", LIVE_CHAT_STATES)
      .limit(1_000),
    admin
      .from("runs")
      .select("sandbox_account")
      .not("sandbox_id", "is", null)
      .in("status", LIVE_RUN_STATUSES)
      .limit(1_000),
    admin
      .from("execution_runs")
      .select("sandbox_account")
      .not("sandbox_id", "is", null)
      .in("status", LIVE_EXECUTION_STATUSES)
      .limit(1_000),
  ]);

  for (const row of (chats.data ?? []) as Array<Record<string, unknown>>) {
    add(row.sandbox_account);
  }
  for (const row of (runs.data ?? []) as Array<Record<string, unknown>>) {
    add(row.sandbox_account);
  }
  for (const row of (executions.data ?? []) as Array<Record<string, unknown>>) {
    add(row.sandbox_account);
  }

  loadCache = { at: now, value: load };
  return load;
}

/**
 * Chooses an account for a box about to be created.
 *
 * Null means nothing is configured. A single account — the shape every existing
 * deployment has — returns without a database read, so the one-key path keeps
 * its current behaviour and its current cost.
 */
export async function chooseSandboxAccount(
  input: {
    seed?: string | null;
    /** Accounts already tried for this box, which must not be chosen again. */
    exclude?: string[];
    admin?: ReturnType<typeof supabaseAdmin>;
  } = {}
): Promise<SandboxAccount | null> {
  const accounts = parseSandboxAccounts();
  if (accounts.length === 0) return null;

  const exclude = new Set(input.exclude ?? []);

  // One account: unchanged behaviour, and no database read. Excluding it means
  // this deployment has nothing left to try, which is reported as no capacity.
  if (accounts.length === 1) {
    const only = accounts[0] ?? null;
    return only && !exclude.has(only.id) ? only : null;
  }

  const admin = input.admin ?? supabaseAdmin();

  let load: Record<string, number> = {};
  let states: Record<string, SandboxAccountState> = {};

  try {
    [load, states] = await Promise.all([
      sandboxAccountLoad(admin),
      sandboxAccountStates(admin),
    ]);
  } catch {
    // A read that fails must not refuse a workspace: an even spread and a
    // skipped full account are preferences, not correctness requirements.
    load = {};
    states = {};
  }

  const usable = availableAccounts(accounts, states).filter(
    (account) => !exclude.has(account.id)
  );

  if (usable.length === 0) return null;

  return pickSandboxAccount({
    accounts: usable,
    load,
    cap: sandboxAccountCap(),
    seed: input.seed ?? null,
  });
}
