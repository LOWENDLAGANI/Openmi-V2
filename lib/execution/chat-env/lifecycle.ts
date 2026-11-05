/**
 * Chat sandbox lifecycle arithmetic.
 *
 * Pure on purpose: no database, no provider, no `server-only`. The resolver, the
 * sweep and the tests read the same numbers, so a deadline cannot drift between
 * the thing that enforces it and the thing that describes it.
 *
 * The product contract these functions encode:
 *
 *   - a chat's workspace is stopped after `CHAT_SANDBOX_IDLE_MINUTES` idle;
 *   - it is destroyed once `CHAT_SANDBOX_TTL_HOURS` have passed since the last
 *     activity, not since creation, so an active chat is never wiped;
 *   - a turn holds a lease, and nothing may stop or wipe a leased environment.
 */

export type ChatSandboxState =
  | "provisioning"
  | "running"
  | "stopped"
  | "archived"
  | "wiping"
  | "failed";

/** The columns the arithmetic needs. Extra columns are fine. */
export type ChatSandboxLifecycleRow = {
  state: ChatSandboxState;
  lastActiveAt: string;
  deleteAfter: string;
  leaseUntil: string | null;
};

export const CHAT_SANDBOX_DEFAULT_IDLE_MINUTES = 5;
export const CHAT_SANDBOX_MIN_IDLE_MINUTES = 1;
export const CHAT_SANDBOX_MAX_IDLE_MINUTES = 60;

export const CHAT_SANDBOX_DEFAULT_TTL_HOURS = 48;
export const CHAT_SANDBOX_MIN_TTL_HOURS = 1;
export const CHAT_SANDBOX_MAX_TTL_HOURS = 168;

/**
 * Added to the provider's wall-clock TTL. `ttlMinutes` destroys a sandbox in any
 * state, so the ceiling is refreshed on open and close; an hour of slack keeps a
 * turn that starts at minute 2879 from being killed mid-command.
 */
export const CHAT_SANDBOX_TTL_SLACK_MINUTES = 60;

export const CHAT_SANDBOX_DEFAULT_MAX_PER_OWNER = 3;
export const CHAT_SANDBOX_MIN_PER_OWNER = 1;
export const CHAT_SANDBOX_MAX_PER_OWNER = 10;

/** Longer than `maxDuration = 300`, so a turn can never outlive its lease. */
export const CHAT_SANDBOX_LEASE_MS = 10 * 60_000;

/** A `provisioning` row older than this, with no lease, is an orphan. */
export const CHAT_SANDBOX_PROVISION_ORPHAN_MS = 15 * 60_000;

/** One sweep invocation acts on at most this many rows per pass. */
export const CHAT_SANDBOX_SWEEP_LIMIT = 25;

function integerFrom(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Whether chat-scoped environments are on.
 *
 * A kill switch, not a capability check: the resolver still requires a Daytona
 * key. Off means the old one-box-per-message path, so this is the rollback.
 */
export function chatSandboxesEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const flag = (env.CHAT_SANDBOX_ENABLED ?? "on").trim().toLowerCase();
  return flag !== "off" && flag !== "false" && flag !== "0";
}

export function chatSandboxIdleMinutes(
  env: Record<string, string | undefined> = process.env
): number {
  return clamp(
    integerFrom(env.CHAT_SANDBOX_IDLE_MINUTES, CHAT_SANDBOX_DEFAULT_IDLE_MINUTES),
    CHAT_SANDBOX_MIN_IDLE_MINUTES,
    CHAT_SANDBOX_MAX_IDLE_MINUTES
  );
}

export function chatSandboxTtlHours(
  env: Record<string, string | undefined> = process.env
): number {
  return clamp(
    integerFrom(env.CHAT_SANDBOX_TTL_HOURS, CHAT_SANDBOX_DEFAULT_TTL_HOURS),
    CHAT_SANDBOX_MIN_TTL_HOURS,
    CHAT_SANDBOX_MAX_TTL_HOURS
  );
}

/** Zero means "do not send autoArchiveInterval" — zero there means 30 days. */
export function chatSandboxArchiveHours(
  env: Record<string, string | undefined> = process.env
): number {
  return clamp(integerFrom(env.CHAT_SANDBOX_ARCHIVE_HOURS, 0), 0, 720);
}

export function chatSandboxMaxPerOwner(
  env: Record<string, string | undefined> = process.env
): number {
  return clamp(
    integerFrom(
      env.CHAT_SANDBOX_MAX_PER_OWNER,
      CHAT_SANDBOX_DEFAULT_MAX_PER_OWNER
    ),
    CHAT_SANDBOX_MIN_PER_OWNER,
    CHAT_SANDBOX_MAX_PER_OWNER
  );
}

/** The wall-clock ceiling sent to the provider, slack included. */
export function chatSandboxTtlMinutes(
  env: Record<string, string | undefined> = process.env
): number {
  return chatSandboxTtlHours(env) * 60 + CHAT_SANDBOX_TTL_SLACK_MINUTES;
}

export function toMillis(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `last_active_at + ttl`, as the ISO string the row stores. */
export function deleteAfter(
  lastActiveAt: number | string,
  ttlHours: number
): string {
  const from =
    typeof lastActiveAt === "number" ? lastActiveAt : Date.parse(lastActiveAt);

  if (!Number.isFinite(from)) {
    throw new Error("chat sandbox: last_active_at is not a date");
  }

  const hours = Math.max(1, Math.trunc(ttlHours));
  return new Date(from + hours * 3_600_000).toISOString();
}

export function leaseUntil(
  now: number = Date.now(),
  leaseMs: number = CHAT_SANDBOX_LEASE_MS
): string {
  return new Date(now + Math.max(1, leaseMs)).toISOString();
}

export function isLeaseLive(
  leaseUntil: string | null,
  now: number = Date.now()
): boolean {
  const until = toMillis(leaseUntil);
  return until !== null && until > now;
}

/**
 * Stop is for a running box that nobody is using. A stopped, archived, wiping or
 * failed row is not a stop candidate, and a leased row belongs to a live turn.
 */
export function shouldStop(
  row: ChatSandboxLifecycleRow,
  now: number = Date.now(),
  idleMinutes: number = chatSandboxIdleMinutes()
): boolean {
  if (row.state !== "running") return false;
  if (isLeaseLive(row.leaseUntil, now)) return false;

  const active = toMillis(row.lastActiveAt);
  if (active === null) return false;

  return active + idleMinutes * 60_000 <= now;
}

/**
 * Wipe is due from any state once the deadline passes, including `wiping` — a
 * failed provider delete is retried by the same rule, not forgotten.
 */
export function shouldWipe(
  row: Pick<ChatSandboxLifecycleRow, "deleteAfter" | "leaseUntil">,
  now: number = Date.now()
): boolean {
  if (isLeaseLive(row.leaseUntil, now)) return false;

  const due = toMillis(row.deleteAfter);
  return due !== null && due <= now;
}

/** A `provisioning` row whose turn died before it could seed or release. */
export function isProvisioningOrphan(
  row: {
    state: ChatSandboxState;
    createdAt: string;
    leaseUntil: string | null;
  },
  now: number = Date.now()
): boolean {
  if (row.state !== "provisioning") return false;
  if (isLeaseLive(row.leaseUntil, now)) return false;

  const created = toMillis(row.createdAt);
  return created !== null && created + CHAT_SANDBOX_PROVISION_ORPHAN_MS <= now;
}

/**
 * GitHub full names and SHAs are compared case-insensitively: a branch moved by
 * hand is not a reason to throw away an installed workspace.
 */
export function pinMatches(
  row: { repoFullName: string; baseSha: string },
  repo: string,
  sha: string
): boolean {
  return (
    row.repoFullName.trim().toLowerCase() === repo.trim().toLowerCase() &&
    row.baseSha.trim().toLowerCase() === sha.trim().toLowerCase()
  );
}

/** A different repository or commit means the disk is stale. */
export function needsReseed(
  row: { repoFullName: string; baseSha: string },
  repo: string,
  sha: string
): boolean {
  return !pinMatches(row, repo, sha);
}

/**
 * What opening a chat should do, before any provider call is made.
 *
 * Kept pure so the expensive half (attach, start, seed, evict) can be tested by
 * inspection and the decision itself by execution. `wait` is not an error: it
 * means another turn holds the lease, and starting a second box would give one
 * chat two filesystems.
 */
export type ChatSandboxOpenDecision =
  | "provision"
  | "reseed"
  | "attach"
  | "start"
  | "wait";

export function decideChatSandboxOpen(input: {
  row:
    | (Pick<ChatSandboxLifecycleRow, "state" | "leaseUntil"> & {
        repoFullName: string;
        baseSha: string;
        createdAt: string;
      })
    | null;
  repo: string;
  sha: string;
  now?: number;
}): ChatSandboxOpenDecision {
  const now = input.now ?? Date.now();
  const row = input.row;

  if (!row) return "provision";
  if (needsReseed(row, input.repo, input.sha)) return "reseed";
  if (isLeaseLive(row.leaseUntil, now)) return "wait";

  switch (row.state) {
    case "running":
      return "attach";
    case "stopped":
    case "archived":
      return "start";
    case "provisioning":
      // Within the orphan window the first turn may still be seeding; after
      // it, the turn that owned the row is gone and the box is replaceable.
      return isProvisioningOrphan(row, now) ? "provision" : "wait";
    case "failed":
    case "wiping":
      return "provision";
    default:
      return "wait";
  }
}

/**
 * Which environments to destroy before creating one more.
 *
 * The cap counts every row for the owner, including a `wiping` orphan: those
 * still occupy a provider disk. The oldest go first, and the chat being opened
 * is never a candidate — a resolver that evicted its own row would reseed in a
 * loop.
 */
export function evictionsForNew<
  T extends { chatId: string | null; lastActiveAt: string },
>(
  rows: T[],
  maxLive: number = CHAT_SANDBOX_DEFAULT_MAX_PER_OWNER,
  excludeChatId: string | null = null
): T[] {
  const cap = Math.max(1, Math.trunc(maxLive));
  // No exclusion means "every row counts", not "drop the orphans". A null
  // chat_id is a row whose chat was purged; it still holds a provider disk and
  // must count against the cap until the wipe finishes.
  const candidates =
    excludeChatId === null
      ? [...rows]
      : rows.filter((row) => row.chatId !== excludeChatId);

  // Creating one needs room for it: N rows and a cap of C means N - C + 1 go.
  const excess = candidates.length - cap + 1;
  if (excess <= 0) return [];

  return [...candidates]
    .sort(
      (a, b) =>
        (toMillis(a.lastActiveAt) ?? 0) - (toMillis(b.lastActiveAt) ?? 0)
    )
    .slice(0, excess);
}
