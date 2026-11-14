"use client";

import { useCallback, useEffect, useState } from "react";

import { RetryNotice } from "@/components/RetryNotice";
import { useSnapBack } from "@/components/useOptimisticAction";
import { isLivePublishState, type PublishState } from "@/lib/publish/plan";

/**
 * Publish, and the truth about it.
 *
 * The button renders a link only when the provider said the deployment is ready.
 * While it is building the card says so; when it fails it shows the provider's
 * own message, because "publish failed" with no reason is the least useful
 * sentence on a page like this.
 *
 * Publishing is a snapshot: a later change needs another press. The label says
 * "Publish" rather than "Deploy" for that reason.
 */

type Deployment = {
  state: PublishState;
  url: string | null;
  error: string | null;
};

export function PublishButton({ chatId }: { chatId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { snapped, snap } = useSnapBack();

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/publish/${chatId}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as
        | {
            enabled?: boolean;
            deployment?: Deployment | null;
            error?: string;
          }
        | null;

      if (!response.ok) {
        setError(body?.error ?? "The deployment state could not be read.");
        return;
      }

      setError(null);
      setEnabled(Boolean(body?.enabled));
      setDeployment(body?.deployment ?? null);
    } catch {
      setError("The deployment state could not be read.");
    }
  }, [chatId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!deployment || !isLivePublishState(deployment.state)) return;

    const timer = window.setInterval(() => {
      void load();
    }, 4_000);

    return () => window.clearInterval(timer);
  }, [deployment, load]);

  if (!enabled) return null;

  const live = deployment ? isLivePublishState(deployment.state) : false;

  // The press takes the lock and says so at once; the deployment card then
  // reports what the provider is actually doing. A refused request puts the
  // button back with the provider's reason, not a silent "Publish" again.
  async function publish() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/publish/${chatId}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error ?? "The app could not be published.");
        snap();
      }

      await load();
    } catch {
      setError("The publish request did not reach the server.");
      snap();
    } finally {
      setBusy(false);
    }
  }

  const failed = deployment?.state === "error" || deployment?.state === "cancelled";
  const reason = error ?? (failed ? deployment?.error : null);

  return (
    <span className="flex items-center gap-1.5">
      {deployment?.url ? (
        <a
          href={deployment.url}
          target="_blank"
          rel="noreferrer"
          className="btn px-2.5 py-1 text-[11px]"
        >
          Open live
        </a>
      ) : null}

      <button
        type="button"
        onClick={publish}
        disabled={busy || live}
        aria-busy={busy || live}
        title={reason ?? "Deploy the branch head. Later changes need another press."}
        className={`btn px-2.5 py-1 text-[11px] ${snapped ? "snap-back" : ""}`}
      >
        {busy || live ? "Publishing…" : "Publish"}
      </button>

      {reason ? (
        <span
          className="max-w-[16rem] truncate text-[10.5px] text-danger"
          title={reason}
        >
          <RetryNotice message={reason} />
        </span>
      ) : null}
    </span>
  );
}
