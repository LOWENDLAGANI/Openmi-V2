"use client";

import { useCallback, useEffect, useState } from "react";

import { StatusPill } from "@/components/StatusPill";
import type {
  PresenceEntry,
  PresenceSnapshot,
} from "@/lib/admin/presence-types";

const POLL_MS = 10_000;

function ago(value: string | null, now: number | null): string {
  if (!value) return "never";

  const then = Date.parse(value);
  if (!Number.isFinite(then)) return "unknown";

  // Match SSR on first paint; switch to live relative timestamps after mount.
  if (now === null) return `${value.slice(0, 16).replace("T", " ")} UTC`;

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

function labelFor(entry: PresenceEntry): string {
  if (entry.email) return entry.email;
  if (entry.handle) return `@${entry.handle}`;
  if (entry.userId) return entry.userId.slice(0, 8);
  const raw = entry.sessionKey.replace(/^anon:/, "");
  return `Guest · ${raw.slice(0, 8)}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2">
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 font-mono text-[14px] leading-none tabular-nums text-hi">
        {value}
      </p>
    </div>
  );
}

export function PresencePanel({
  initial,
  currentAdminId,
}: {
  initial: PresenceSnapshot;
  currentAdminId: string;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState<number | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/admin/presence", {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | { snapshot?: PresenceSnapshot }
        | null;

      if (response.ok && body?.snapshot) {
        setSnapshot(body.snapshot);
      }
    } catch {
      // Quiet poll keeps last known snapshot on transient failures.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setClock(Date.now());

    const ticking = window.setInterval(() => setClock(Date.now()), 5_000);
    const poller = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, POLL_MS);

    return () => {
      window.clearInterval(ticking);
      window.clearInterval(poller);
    };
  }, [load]);

  const lastUser = snapshot.lastUser;
  const lastOtherUser =
    snapshot.recentUsers.find((entry) => entry.userId !== currentAdminId) ??
    null;

  return (
    <section aria-labelledby="presence-heading" className="panel mt-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="presence-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
          >
            Live visitors &amp; active users
          </h2>
          <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-mid">
            Real-time view of who is currently active on the website (last{" "}
            {Math.round(snapshot.activeWindowSeconds / 60)} min) and who was
            last seen. Updates every 10 seconds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={snapshot.activeTotal > 0 ? "ok" : "optional"}>
            {snapshot.activeTotal} online now
          </StatusPill>
          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            className="btn px-3 py-1.5 text-[11px]"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {snapshot.source === "fallback" && (
        <p className="mt-3 rounded-xl border border-warn/30 bg-warn/8 px-3 py-2 text-[11px] text-warn">
          Showing recent chat/run activity. Push migration{" "}
          <code className="font-mono">060_user_presence.sql</code> to enable
          live page-level heartbeats and guest tracking.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="online now" value={String(snapshot.activeTotal)} />
        <Metric label="members online" value={String(snapshot.activeMembers)} />
        <Metric label="guests online" value={String(snapshot.activeGuests)} />
        <Metric
          label="last activity"
          value={ago(lastUser?.lastSeenAt ?? null, clock)}
        />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl border border-line bg-raised p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold tracking-[-0.02em] text-hi">
              Last user on website
            </h3>
            {lastUser && (
              <StatusPill tone={lastUser.active ? "ok" : "optional"}>
                {lastUser.active ? "active now" : "offline"}
              </StatusPill>
            )}
          </div>

          {lastUser ? (
            <div className="mt-2.5 rounded-xl border border-line bg-card px-3.5 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p
                  className="truncate text-[12.5px] font-medium text-hi"
                  title={labelFor(lastUser)}
                >
                  {labelFor(lastUser)}
                  {lastUser.userId === currentAdminId ? (
                    <span className="ml-1.5 font-mono text-[10px] font-normal text-low">
                      (you)
                    </span>
                  ) : null}
                </p>
                <span className="font-mono text-[10.5px] tabular-nums text-low">
                  {ago(lastUser.lastSeenAt, clock)}
                </span>
              </div>
              <p className="mt-1 font-mono text-[10.5px] text-low">
                {lastUser.kind} · page {lastUser.lastPath}
              </p>
            </div>
          ) : (
            <p className="mt-2.5 text-[12px] text-mid">
              No visitor activity recorded yet.
            </p>
          )}

          {lastUser?.userId === currentAdminId && (
            <div className="mt-2.5 rounded-xl border border-line bg-card/70 px-3.5 py-2">
              <p className="eyebrow">last other user</p>
              {lastOtherUser ? (
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] text-body">
                    {labelFor(lastOtherUser)}
                  </span>
                  <span className="font-mono text-[10.5px] tabular-nums text-low">
                    {lastOtherUser.lastPath} ·{" "}
                    {ago(lastOtherUser.lastSeenAt, clock)}
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-[11.5px] text-low">
                  No other visitor seen yet.
                </p>
              )}
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-line bg-raised p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold tracking-[-0.02em] text-hi">
              Currently active ({snapshot.activeTotal})
            </h3>
            <span className="font-mono text-[10px] tabular-nums text-low">
              updated {ago(snapshot.capturedAt, clock)}
            </span>
          </div>

          {snapshot.activeUsers.length === 0 ? (
            <p className="mt-2.5 text-[12px] text-mid">
              Nobody active in the last{" "}
              {Math.round(snapshot.activeWindowSeconds / 60)} minutes.
            </p>
          ) : (
            <ul className="mt-2.5 max-h-52 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-card px-3">
              {snapshot.activeUsers.map((entry) => (
                <li
                  key={entry.sessionKey}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-[12px] text-body"
                      title={labelFor(entry)}
                    >
                      {labelFor(entry)}
                      {entry.userId === currentAdminId ? (
                        <span className="ml-1 font-mono text-[10px] text-low">
                          (you)
                        </span>
                      ) : null}
                    </p>
                    <p className="font-mono text-[10px] text-low">
                      {entry.lastPath}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill tone={entry.kind === "member" ? "ok" : "optional"}>
                      {entry.kind}
                    </StatusPill>
                    <span className="font-mono text-[10px] tabular-nums text-low">
                      {ago(entry.lastSeenAt, clock)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {snapshot.recentUsers.length > 0 && (
        <details className="mt-3 rounded-2xl border border-line bg-raised px-4 py-3">
          <summary className="cursor-pointer text-[12px] font-medium text-mid hover:text-hi">
            Recent visitors ({snapshot.recentUsers.length})
          </summary>
          <ul className="mt-2.5 divide-y divide-line">
            {snapshot.recentUsers.map((entry) => (
              <li
                key={`recent-${entry.sessionKey}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[12px] text-body">
                    {labelFor(entry)}
                    {entry.userId === currentAdminId ? (
                      <span className="ml-1 font-mono text-[10px] text-low">
                        (you)
                      </span>
                    ) : null}
                  </p>
                  <p className="font-mono text-[10px] text-low">
                    {entry.kind} · {entry.lastPath}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusPill tone={entry.active ? "ok" : "optional"}>
                    {entry.active ? "online" : "seen"}
                  </StatusPill>
                  <span className="font-mono text-[10px] tabular-nums text-low">
                    {ago(entry.lastSeenAt, clock)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
