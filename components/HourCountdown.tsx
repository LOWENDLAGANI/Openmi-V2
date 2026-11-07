"use client";

import { useEffect, useState } from "react";

import { formatHourRemaining, hourRemainingMs } from "@/lib/dew";

/**
 * How much of the paid hour is left.
 *
 * The hour is charged once and covers every turn inside it, so the number that
 * matters is time remaining, not tokens. It ticks once a second on the client.
 *
 * Two rules keep the number honest:
 *
 * - The reference is the server's `now`, passed with the expiry, and the tick
 *   is `performance.now()`. A phone whose clock is hours off used to read "8
 *   hours left" for a one-hour session, because the old version subtracted its
 *   own wall clock from a server timestamp.
 * - The clock never exceeds the hour that was sold. The remaining time is
 *   capped at the fixed hour length, so a bad row cannot promise one either.
 *
 * The first paint is a placeholder on purpose: the server has no business
 * rendering the reader's clock, and formatting a countdown there would produce
 * a hydration mismatch one second wide.
 */
export function HourCountdown({
  endsAt,
  serverNow,
}: {
  endsAt: string;
  serverNow: string;
}) {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    // A monotonic reference: unaffected by a wall clock that is wrong or that
    // changes while the page is open.
    const started = performance.now();
    setElapsed(0);

    const id = window.setInterval(
      () => setElapsed(performance.now() - started),
      1_000
    );

    return () => window.clearInterval(id);
  }, [endsAt, serverNow]);

  const remaining =
    elapsed === null ? null : hourRemainingMs({ endsAt, serverNow, elapsedMs: elapsed });

  return (
    <div
      className="mx-4 mt-3 flex items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2"
      title="The hour is paid for; every turn inside it is free."
    >
      <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-low">
        hour left
      </span>
      <span
        className="font-mono text-[12.5px] leading-none tabular-nums text-hi"
        aria-label="Time left in the running hour"
      >
        {remaining === null
          ? "—:—"
          : remaining > 0
            ? formatHourRemaining(remaining)
            : "ended"}
      </span>
    </div>
  );
}
