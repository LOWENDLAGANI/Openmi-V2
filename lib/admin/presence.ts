import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PRESENCE_ACTIVE_WINDOW_MS,
  summarizePresence,
  type PresenceSnapshot,
  type RawPresenceRow,
} from "./presence-types";

/**
 * Reads live website presence for the /admin operations panel.
 *
 * Uses `public.user_presence` when migration 060 has been pushed. If the table
 * does not exist yet on a deployment, falls back cleanly to recent chat/run
 * activity so the panel still works without throwing.
 */
export async function readPresenceSnapshot(
  admin: SupabaseClient,
  now: number = Date.now()
): Promise<PresenceSnapshot> {
  const { data, error } = await admin
    .from("user_presence")
    .select("session_key, user_id, email, handle, last_path, last_seen_at")
    .order("last_seen_at", { ascending: false })
    .limit(100);

  if (!error && Array.isArray(data)) {
    return summarizePresence(data as RawPresenceRow[], {
      now,
      source: "live",
      activeWindowMs: PRESENCE_ACTIVE_WINDOW_MS,
    });
  }

  return readFallbackPresence(admin, now);
}

async function readFallbackPresence(
  admin: SupabaseClient,
  now: number
): Promise<PresenceSnapshot> {
  const [runsResult, chatsResult] = await Promise.all([
    admin
      .from("runs")
      .select("owner, heartbeat_at, created_at")
      .order("created_at", { ascending: false })
      .limit(40),
    admin
      .from("chats")
      .select("owner, updated_at")
      .order("updated_at", { ascending: false })
      .limit(40),
  ]);

  const latestByOwner = new Map<string, { at: string; path: string }>();

  const consider = (owner: string, at: string | null | undefined, path: string) => {
    if (!owner || !at) return;
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) return;
    const existing = latestByOwner.get(owner);
    if (!existing || Date.parse(existing.at) < ms) {
      latestByOwner.set(owner, { at, path });
    }
  };

  for (const row of (runsResult.data ?? []) as Array<{
    owner: string;
    heartbeat_at: string | null;
    created_at: string;
  }>) {
    consider(row.owner, row.heartbeat_at ?? row.created_at, "/chat");
  }

  for (const row of (chatsResult.data ?? []) as Array<{
    owner: string;
    updated_at: string;
  }>) {
    consider(row.owner, row.updated_at, "/chat");
  }

  const ownerIds = [...latestByOwner.keys()];
  const profilesResult =
    ownerIds.length > 0
      ? await admin
          .from("profiles")
          .select("id, email, handle")
          .in("id", ownerIds)
      : { data: [] };

  const profileMap = new Map(
    ((profilesResult.data ?? []) as Array<{
      id: string;
      email: string | null;
      handle: string | null;
    }>).map((row) => [row.id, row])
  );

  const rows: RawPresenceRow[] = ownerIds.map((owner) => {
    const activity = latestByOwner.get(owner)!;
    const profile = profileMap.get(owner);
    return {
      session_key: `user:${owner}`,
      user_id: owner,
      email: profile?.email ?? null,
      handle: profile?.handle ?? null,
      last_path: activity.path,
      last_seen_at: activity.at,
    };
  });

  return summarizePresence(rows, {
    now,
    source: "fallback",
    activeWindowMs: PRESENCE_ACTIVE_WINDOW_MS,
  });
}
