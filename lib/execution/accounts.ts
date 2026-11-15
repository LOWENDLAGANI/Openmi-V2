import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import {
  LEGACY_SANDBOX_ACCOUNT,
  parseSandboxAccounts,
  pickSandboxAccount,
  sandboxAccountCap,
  type SandboxAccount,
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
  accountsConfigured,
  parseSandboxAccounts,
  pickSandboxAccount,
  recordedAccountId,
  sandboxAccountCap,
  sandboxAccounts,
  type SandboxAccount,
} from "./account-pool";

/** States that hold a live box and therefore count against an account. */
const LIVE_CHAT_STATES = ["provisioning", "running", "stopped", "archived", "wiping"];
const LIVE_RUN_STATUSES = ["queued", "running"];
const LIVE_EXECUTION_STATUSES = ["queued", "running", "paused"];

type LoadCache = { at: number; value: Record<string, number> };

let loadCache: LoadCache | null = null;

const LOAD_TTL_MS = 30_000;

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
    admin?: ReturnType<typeof supabaseAdmin>;
  } = {}
): Promise<SandboxAccount | null> {
  const accounts = parseSandboxAccounts();
  if (accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0] ?? null;

  let load: Record<string, number> = {};

  try {
    load = await sandboxAccountLoad(input.admin ?? supabaseAdmin());
  } catch {
    // A load read that fails must not refuse a workspace: an even spread is a
    // preference, not a correctness requirement.
    load = {};
  }

  return pickSandboxAccount({
    accounts,
    load,
    cap: sandboxAccountCap(),
    seed: input.seed ?? null,
  });
}
