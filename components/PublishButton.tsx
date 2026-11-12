"use client";

import { useCallback, useEffect, useState } from "react";

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

  async function publish() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/publish/${chatId}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error ?? "The app could not be published.");
      }

      await load();
    } catch {
      setError("The publish request did not reach the server.");
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
        title={reason ?? "Deploy the branch head. Later changes need another press."}
        className="btn px-2.5 py-1 text-[11px]"
      >
        {busy || live ? "Publishing…" : "Publish"}
      </button>

      {reason ? (
        <span
          className="max-w-[16rem] truncate text-[10.5px] text-danger"
          title={reason}
        >
          {reason}
        </span>
      ) : null}
    </span>
  );
}
