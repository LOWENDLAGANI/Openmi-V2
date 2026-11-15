/**
 * The E2B account pool, as pure functions.
 *
 * Kept free of `server-only`, the database client and the sandbox SDK so the
 * parsing and the selection rule can be tested by execution. `accounts.ts` is
 * the server half: it reads the live counts and chooses an account for a new
 * box using this module's rule.
 *
 * A sandbox id is scoped to the team that created it, so the account label is as
 * much a part of "where is this box" as the id is. Configuration accepts either
 * form:
 *
 *     E2B_API_KEY=e2b_...                       # one key → account "default"
 *     E2B_ACCOUNTS="acct-1:e2b_aaa,acct-2:e2b_bbb"
 *
 * Labels are not secrets. They are written to the database and shown on the
 * admin page, so they are validated as slugs; the key is only ever read back by
 * the provider.
 */

export const LEGACY_SANDBOX_ACCOUNT = "default";

export type SandboxAccount = {
  /** Stable, non-secret label recorded next to every sandbox it creates. */
  id: string;
  /** The team key. Never logged, never returned to a browser, never stored. */
  key: string;
};

const ACCOUNT_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Accounts from the environment, legacy key last.
 *
 * A malformed list never disables execution: entries that do not parse are
 * skipped and the single `E2B_API_KEY` still resolves, so a typo in a new
 * setting cannot take sandboxes down. Duplicates keep the first entry — a list
 * edited by hand is more likely to gain a duplicate than to mean the later key.
 */
export function parseSandboxAccounts(
  env: Record<string, string | undefined> = process.env
): SandboxAccount[] {
  const accounts: SandboxAccount[] = [];
  const seen = new Set<string>();

  const add = (rawId: string, rawKey: string) => {
    const id = rawId.trim().toLowerCase();
    const key = rawKey.trim();
    if (!ACCOUNT_ID.test(id) || key.length === 0 || seen.has(id)) return;
    seen.add(id);
    accounts.push({ id, key });
  };

  const list = (env.E2B_ACCOUNTS ?? "").trim();

  for (const entry of list.split(/[,;\n]+/)) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;

    const cut = trimmed.indexOf(":");
    if (cut <= 0) continue;

    add(trimmed.slice(0, cut), trimmed.slice(cut + 1));
  }

  const single = (env.E2B_API_KEY ?? "").trim();
  if (single.length > 0) add(LEGACY_SANDBOX_ACCOUNT, single);

  return accounts;
}

export function sandboxAccounts(
  env: Record<string, string | undefined> = process.env
): SandboxAccount[] {
  return parseSandboxAccounts(env);
}

export function accountsConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  return parseSandboxAccounts(env).length > 0;
}

/** The credentials for a recorded label, or null when it is not configured. */
export function accountById(
  id: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): SandboxAccount | null {
  if (typeof id !== "string") return null;
  const wanted = id.trim().toLowerCase();
  if (wanted.length === 0) return null;

  return parseSandboxAccounts(env).find((account) => account.id === wanted) ?? null;
}

/** Clamps `E2B_ACCOUNT_MAX_SANDBOXES`; null means uncapped. */
export function sandboxAccountCap(
  env: Record<string, string | undefined> = process.env
): number | null {
  const raw = Number((env.E2B_ACCOUNT_MAX_SANDBOXES ?? "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.min(1_000, Math.max(1, Math.trunc(raw)));
}

/** FNV-1a, only to give a stable starting point inside the account list. */
function stableSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The account a new box should use.
 *
 * Drop accounts at their cap, take the one with the fewest live boxes, and break
 * ties by rotating the list from a hash of the seed (a chat id, a run id). The
 * rotation is what keeps a given workspace landing on the same account while the
 * spread stays even; `Array.sort` is stable, so equal loads keep that order.
 *
 * Null means nothing is configured — the caller decides what that means, and for
 * a create it is "execution is not configured", not "no space".
 */
export function pickSandboxAccount(input: {
  accounts: SandboxAccount[];
  load?: Record<string, number>;
  cap?: number | null;
  /** A stable string — chat id, run id — for the tie-break. */
  seed?: string | null;
}): SandboxAccount | null {
  const { accounts } = input;
  if (accounts.length === 0) return null;

  const load = input.load ?? {};
  const cap = input.cap ?? null;

  const underCap =
    cap === null
      ? accounts
      : accounts.filter((account) => (load[account.id] ?? 0) < cap);

  // Every account at its cap still has to answer: refusing a workspace because
  // each one is one over a soft cap is worse than exceeding it by one. The
  // choice is made, and the excess is what the admin panel is for.
  const pool = underCap.length > 0 ? underCap : accounts;

  const start = stableSeed(input.seed ?? "") % pool.length;
  const rotated = pool.map((_, index) => pool[(start + index) % pool.length]);

  rotated.sort((a, b) => (load[a.id] ?? 0) - (load[b.id] ?? 0));

  return rotated[0] ?? null;
}

/** The label to record for a box, falling back to the legacy one for old rows. */
export function recordedAccountId(id: string | null | undefined): string {
  return typeof id === "string" && id.trim().length > 0
    ? id.trim().toLowerCase()
    : LEGACY_SANDBOX_ACCOUNT;
}
