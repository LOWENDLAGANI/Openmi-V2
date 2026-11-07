"use client";

import { useEffect, useState } from "react";

import { formatHourRemaining } from "@/lib/dew";

/**
 * How much of the paid hour is left.
 *
 * The hour is charged once and covers every turn inside it, so the number that
 * matters is time remaining, not tokens. It ticks once a second on the client.
 *
 * The first paint is a placeholder on purpose: the server has no business
 * rendering the reader's clock, and formatting a countdown there would produce
 * a hydration mismatch one second wide.
 */
export function HourCountdown({ endsAt }: { endsAt: string }) {
  const target = new Date(endsAt).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(target)) return;

    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [target]);

  if (!Number.isFinite(target)) return null;

  const remaining = now === null ? null : target - now;

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
