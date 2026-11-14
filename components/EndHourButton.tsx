"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { PendingButton } from "@/components/PendingButton";

/**
 * Ends the running hour from the page that owns the hour.
 *
 * The route has existed since the conflict path needed it; without a control,
 * a reader whose hour was running in another chat had no way to stop paying for
 * it except by finding that chat. No refund is implied: the hour was available
 * and ending it is a choice, so the copy says "End", not "Refund".
 */
export function EndHourButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <PendingButton
        className="btn px-3 py-1 text-[11px]"
        optimisticText="Ended"
        pendingText="Ending…"
        onAction={async () => {
          const response = await fetch("/api/dew/end-session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
          const body = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;

          if (!response.ok) {
            setError(body?.error ?? "The hour could not be ended.");
            return;
          }

          setError(null);
          router.refresh();
        }}
      >
        End hour
      </PendingButton>

      {error ? (
        <span className="text-[10.5px] leading-relaxed text-danger">{error}</span>
      ) : null}
    </span>
  );
}
