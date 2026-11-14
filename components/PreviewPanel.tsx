"use client";

import { useCallback, useEffect, useState } from "react";

import { RetryNotice } from "@/components/RetryNotice";
import { useSnapBack } from "@/components/useOptimisticAction";

/**
 * The app a chat is building, shown beside the transcript.
 *
 * Collapsed by default: a chat that is only reading code should not give up
 * half its height to an empty frame. The panel never invents a state — it
 * renders what the route reports, and a failed start shows the dev server's own
 * last lines rather than a guess about what went wrong.
 *
 * The URL is a public sandbox host, and the note under the frame says so. A
 * preview that is quietly reachable by anyone is exactly the kind of claim this
 * product refuses to make by omission.
 */

type PreviewState = "stopped" | "starting" | "ready" | "failed";

type Status = {
  enabled: boolean;
  state: PreviewState;
  url: string | null;
  port: number | null;
  command: string | null;
  failure: string | null;
  stopReason: string | null;
};

const LABEL: Record<PreviewState, string> = {
  stopped: "not running",
  starting: "starting",
  ready: "running",
  failed: "could not start",
};

export function PreviewPanel({
  chatId,
  enabled,
  active = true,
}: {
  chatId: string;
  enabled: boolean;
  /** False while another tab of the dock is on screen. Hidden, never unmounted. */
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  // Which action is in flight, so the optimistic state is the one that was
  // asked for: a press of Stop must not paint the panel as starting.
  const [pending, setPending] = useState<"start" | "stop" | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { snapped, snap } = useSnapBack();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/preview/${chatId}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as Status | null;

      if (!response.ok || !body) {
        setError(body?.failure ?? "The preview state could not be read.");
        return;
      }

      setError(null);
      setStatus(body);
      if (body.state === "ready") setOpen(true);
    } catch {
      setError("The preview state could not be read.");
    }
  }, [chatId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  // A running preview is polled while it is on screen: the touch keeps it
  // inside the idle window, and a server that died shows up as stopped instead
  // of as a frame that silently stopped updating.
  useEffect(() => {
    if (!enabled || status?.state !== "ready") return;

    const timer = window.setInterval(() => {
      void refresh();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [enabled, refresh, status?.state]);

  if (!enabled) return null;

  const state =
    pending === "start"
      ? "starting"
      : pending === "stop"
        ? "stopped"
        : (status?.state ?? "stopped");
  const url = status?.url ?? null;
  const detail = error ?? status?.failure ?? null;

  // The press flips the panel to the state it was asked for in the same frame;
  // the server's answer either confirms it or puts it back with its own error.
  async function act(action: "start" | "stop") {
    if (pending !== null) return;

    setPending(action);
    setError(null);

    try {
      const response = await fetch(`/api/preview/${chatId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });

      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error ?? "The preview could not be changed.");
        snap();
      }

      if (action === "start") setOpen(true);
    } catch {
      setError("The preview request did not reach the server.");
      snap();
    } finally {
      setPending(null);
      await refresh();
    }
  }

  const dot =
    state === "ready"
      ? "bg-accent"
      : state === "starting"
        ? "bg-warn"
        : state === "failed"
          ? "bg-danger"
          : "bg-line-strong";

  return (
    <div className={active ? "" : "hidden"}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 text-[11px] text-mid hover:text-hi"
        >
          <span aria-hidden="true" className="text-low">
            {open ? "▾" : "▸"}
          </span>
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dot}`} />
          <span className="truncate">
            {LABEL[state]}
            {status?.port ? ` · port ${status.port}` : ""}
          </span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="btn px-2 py-0.5 text-[10.5px]"
            >
              Open
            </a>
          ) : null}

          {state === "ready" ? (
            <button
              type="button"
              onClick={() => setReload((value) => value + 1)}
              className="btn px-2 py-0.5 text-[10.5px]"
            >
              Reload
            </button>
          ) : null}

          {state === "ready" || state === "starting" || pending === "stop" ? (
            <button
              type="button"
              onClick={() => act("stop")}
              disabled={busy}
              aria-busy={busy}
              className={`btn px-2 py-0.5 text-[10.5px] ${snapped ? "snap-back" : ""}`}
            >
              {pending === "stop" ? "Stopped" : "Stop"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => act("start")}
              disabled={busy}
              aria-busy={busy}
              className={`btn px-2 py-0.5 text-[10.5px] ${snapped ? "snap-back" : ""}`}
            >
              {pending === "start" ? "Started" : "Start preview"}
            </button>
          )}
        </div>
      </div>

      {open ? (
        state === "ready" && url ? (
          <div className="border-t border-line p-2">
            <iframe
              key={`${url}-${reload}`}
              src={url}
              title="App preview"
              className="h-[42vh] w-full rounded-xl border border-line bg-card"
              sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            />
            <p className="px-1 pt-2 text-[10.5px] leading-relaxed text-low">
              While this runs, anyone with its link can open it. Stop it when you
              are done.
            </p>
          </div>
        ) : (
          <div className="border-t border-line px-3 py-2.5 text-[11px] leading-relaxed text-mid">
            {state === "starting" ? (
              <p>
                Starting the repository&apos;s own dev script in the sandbox. A
                first start can take a minute.
              </p>
            ) : state === "failed" ? (
              <p className="text-danger">
                The dev server did not start. Its last output is below.
              </p>
            ) : (
              <p>
                Nothing is running. Start the preview to serve this chat&apos;s
                workspace on a sandbox port.
              </p>
            )}
          </div>
        )
      ) : null}

      {state === "stopped" && status?.stopReason ? (
        <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-mid">
          {status.stopReason}
        </p>
      ) : null}

      {detail ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-line px-3 py-2 font-mono text-[10.5px] leading-relaxed text-danger">
          <RetryNotice message={detail} />
        </pre>
      ) : null}
    </div>
  );
}
