"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

import { formatHourRemaining, hourRemainingMs } from "@/lib/credits";

/**
 * Remaining time in the running paid hour, measured monotonically against the
 * server clock.
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
      className="mx-3 mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-line bg-card px-2.5 py-2"
      title="The hour is paid for; every turn inside it is free."
    >
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-mid">
        <Clock aria-hidden="true" className="size-3.5 text-accent-text" strokeWidth={1.75} />
        Active hour
      </span>
      <span
        className="font-mono text-[12px] font-medium leading-none tabular-nums text-hi"
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
