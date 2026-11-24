import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  PRESENCE_ACTIVE_WINDOW_MS,
  sanitizePresencePath,
  sanitizeVisitorId,
  summarizePresence,
} from "../lib/admin/presence-types";

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

describe("admin real-time presence", () => {
  test("sanitizePresencePath strips query strings and rejects non-relative paths", () => {
    expect(sanitizePresencePath("/chat?chat=123#top")).toBe("/chat");
    expect(sanitizePresencePath("/admin/feedback")).toBe("/admin/feedback");
    expect(sanitizePresencePath("https://evil.test/x")).toBe("/");
    expect(sanitizePresencePath("")).toBe("/");
    expect(sanitizePresencePath(null)).toBe("/");
  });

  test("sanitizeVisitorId accepts only bounded token strings", () => {
    expect(sanitizeVisitorId("abcd1234efgh")).toBe("abcd1234efgh");
    expect(sanitizeVisitorId("short")).toBeNull();
    expect(sanitizeVisitorId("bad space id")).toBeNull();
    expect(sanitizeVisitorId(42)).toBeNull();
  });

  test("summarizePresence counts active members/guests and picks the latest user", () => {
    const now = Date.parse("2026-11-24T12:00:00.000Z");

    const snapshot = summarizePresence(
      [
        {
          session_key: "user:u-old",
          user_id: "u-old",
          email: "old@example.test",
          handle: "old",
          last_path: "/chat",
          last_seen_at: new Date(now - PRESENCE_ACTIVE_WINDOW_MS - 30_000).toISOString(),
        },
        {
          session_key: "anon:guest123456",
          user_id: null,
          email: null,
          handle: null,
          last_path: "/pricing?ref=abc",
          last_seen_at: new Date(now - 10_000).toISOString(),
        },
        {
          session_key: "user:u-live",
          user_id: "u-live",
          email: "live@example.test",
          handle: "live",
          last_path: "/chat",
          last_seen_at: new Date(now - 35_000).toISOString(),
        },
      ],
      { now, source: "live" }
    );

    expect(snapshot.activeTotal).toBe(2);
    expect(snapshot.activeMembers).toBe(1);
    expect(snapshot.activeGuests).toBe(1);
    expect(snapshot.lastUser?.sessionKey).toBe("anon:guest123456");
    expect(snapshot.lastUser?.lastPath).toBe("/pricing");
    expect(snapshot.recentUsers).toHaveLength(3);
  });

  test("migration, routes, beacon, and admin panel enforce security and wiring", () => {
    const migration = read("/supabase/migrations/060_user_presence.sql");
    const presenceRoute = read("/app/api/presence/route.ts");
    const adminRoute = read("/app/api/admin/presence/route.ts");
    const layout = read("/app/layout.tsx");
    const adminPage = read("/app/admin/page.tsx");

    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.user_presence from public, anon, authenticated");
    expect(migration).toContain("to service_role");

    expect(presenceRoute).toContain("isSameOrigin(request)");
    expect(adminRoute).toContain("readAdminAccess()");
    expect(adminRoute).toContain("404");

    expect(layout).toContain("PresenceBeacon");
    expect(adminPage).toContain("PresencePanel");
    expect(adminPage).toContain("readPresenceSnapshot");
  });
});
