/**
 * Shared types and pure helpers for real-time website presence monitoring.
 *
 * Kept free of `server-only` so both the admin client panel and unit tests
 * can import these directly.
 */

/** A user whose last heartbeat is within this window counts as online now. */
export const PRESENCE_ACTIVE_WINDOW_MS = 2 * 60_000;

/** How often an open visible tab sends a heartbeat. */
export const PRESENCE_HEARTBEAT_MS = 30_000;

export type PresenceEntry = {
  sessionKey: string;
  userId: string | null;
  email: string | null;
  handle: string | null;
  kind: "member" | "guest";
  lastPath: string;
  lastSeenAt: string;
  active: boolean;
};

export type PresenceSnapshot = {
  capturedAt: string;
  activeWindowSeconds: number;
  source: "live" | "fallback";
  activeTotal: number;
  activeMembers: number;
  activeGuests: number;
  activeUsers: PresenceEntry[];
  /** Most recently seen user overall on the website. */
  lastUser: PresenceEntry | null;
  /** Most recent visitors/members (active and recently departed), newest first. */
  recentUsers: PresenceEntry[];
};

export type RawPresenceRow = {
  session_key: string;
  user_id: string | null;
  email: string | null;
  handle: string | null;
  last_path: string | null;
  last_seen_at: string;
};

/** Keeps only a clean, bounded relative pathname without query strings or hashes. */
export function sanitizePresencePath(value: unknown): string {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return "/";
  const withoutQuery = trimmed.split(/[?#]/)[0] ?? "/";
  const cleaned = withoutQuery.replace(/[^A-Za-z0-9/_\-.~]/g, "").slice(0, 120);
  return cleaned.length > 0 && cleaned.startsWith("/") ? cleaned : "/";
}

/** Validates an anonymous tab visitor id before using it as a session key. */
export function sanitizeVisitorId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(trimmed)) return null;
  return trimmed;
}

/** Builds a PresenceSnapshot from raw rows ordered newest-first. */
export function summarizePresence(
  rows: readonly RawPresenceRow[],
  options: {
    now?: number;
    source?: "live" | "fallback";
    activeWindowMs?: number;
    recentLimit?: number;
  } = {}
): PresenceSnapshot {
  const now = options.now ?? Date.now();
  const activeWindowMs = options.activeWindowMs ?? PRESENCE_ACTIVE_WINDOW_MS;
  const recentLimit = options.recentLimit ?? 15;
  const cutoff = now - activeWindowMs;

  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at)
  );

  const entries: PresenceEntry[] = sorted.map((row) => {
    const seenMs = Date.parse(row.last_seen_at);
    const active = Number.isFinite(seenMs) && seenMs >= cutoff;
    const isMember = Boolean(row.user_id || row.email);

    return {
      sessionKey: row.session_key,
      userId: row.user_id,
      email: row.email,
      handle: row.handle,
      kind: isMember ? "member" : "guest",
      lastPath: sanitizePresencePath(row.last_path),
      lastSeenAt: row.last_seen_at,
      active,
    };
  });

  const activeUsers = entries.filter((entry) => entry.active);
  const activeMembers = activeUsers.filter((entry) => entry.kind === "member").length;
  const activeGuests = activeUsers.length - activeMembers;

  return {
    capturedAt: new Date(now).toISOString(),
    activeWindowSeconds: Math.round(activeWindowMs / 1000),
    source: options.source ?? "live",
    activeTotal: activeUsers.length,
    activeMembers,
    activeGuests,
    activeUsers,
    lastUser: entries[0] ?? null,
    recentUsers: entries.slice(0, recentLimit),
  };
}
