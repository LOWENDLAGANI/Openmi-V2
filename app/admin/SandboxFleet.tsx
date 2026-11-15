"use client";

import { useEffect, useState } from "react";

import { StatusPill } from "@/components/StatusPill";
import {
  agoLabel,
  fleetStatus,
  minutesLeft,
  type SandboxFleetReport,
} from "@/lib/execution/fleet-types";

/**
 * Which sandbox account is working, and when each was last tried.
 *
 * The page renders the first answer on the server; this component asks the
 * status route again every few seconds, because the interesting events — an
 * account hitting its limit, a key being rejected — happen while an operator is
 * looking at the page. The countdown for a cooling account ticks on the same
 * clock, so "cooling 4m" is never stale by more than a second.
 *
 * Polling rather than a socket on purpose: the fleet changes are rare, one small
 * authenticated GET is cheap, and a panel that survives a dropped connection by
 * simply trying again is worth more than one that needs a reconnect path.
 */

const POLL_MS = 5_000;

export function SandboxFleet({ initial }: { initial: SandboxFleetReport }) {
  const [report, setReport] = useState(initial);
  const [now, setNow] = useState(() => Date.parse(initial.checkedAt));
  const [live, setLive] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let next: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const response = await fetch("/api/admin/status", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });

        if (!response.ok) throw new Error(`status ${response.status}`);

        const body = (await response.json()) as {
          fleet?: SandboxFleetReport | null;
        };

        if (stopped) return;

        if (body.fleet) {
          setReport(body.fleet);
          setLive(true);
          setProblem(null);
        } else {
          // The session stopped being an admin, or the role check failed.
          setLive(false);
          setProblem("session is no longer an admin");
        }
      } catch (caught) {
        if (stopped) return;
        setLive(false);
        setProblem(
          caught instanceof Error && caught.message.length > 0
            ? caught.message
            : "unreachable"
        );
      }

      if (!stopped) next = setTimeout(poll, POLL_MS);
    };

    next = setTimeout(poll, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1_000);

    return () => {
      stopped = true;
      if (next) clearTimeout(next);
      clearInterval(clock);
    };
  }, []);

  const totals = report.totals;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={live ? "ok" : "missing"}>
          {live ? "live" : "paused"}
        </StatusPill>
        <p className="text-[10.5px] text-low">
          {totals.acceptingNew} of {totals.configured || 0} taking new sandboxes ·
          {" "}
          {totals.live} box{totals.live === 1 ? "" : "es"} live
          {problem ? ` · ${problem}` : ""}
        </p>
      </div>

      {report.accounts.length === 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-mid">
          No sandbox account is configured. Add <code>E2B_API_KEY</code>, or
          labelled keys as <code>E2B_ACCOUNTS</code>, to see them here.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {report.accounts.map((account) => {
            const status = fleetStatus(account, now);
            const cooling = minutesLeft(account.setAsideUntil, now);

            return (
              <li
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12px] text-body">
                      {account.id}
                    </span>
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                    {!account.acceptingNew && account.configured && (
                      <span className="font-mono text-[10px] text-low">
                        skipped for new boxes
                      </span>
                    )}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-low">
                    last tried {agoLabel(account.lastTriedAt, now)} · last worked{" "}
                    {agoLabel(account.lastOkAt, now)}
                    {account.cap !== null ? ` · cap ${account.cap}` : ""}
                  </p>
                  {account.lastFailure && (
                    <p
                      className="mt-1 max-w-[52ch] truncate text-[10.5px] text-mid"
                      title={account.lastFailure}
                    >
                      {account.lastFailure}
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <p className="font-mono text-[12px] text-hi">
                    {account.live}
                    <span className="text-low">
                      {account.cap !== null ? `/${account.cap}` : ""}
                    </span>
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-low">
                    {account.chat} chat · {account.runs} run ·{" "}
                    {account.executions} exec
                  </p>
                  {cooling !== null && (
                    <p className="mt-0.5 font-mono text-[10px] text-warn">
                      back in {cooling}m
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
