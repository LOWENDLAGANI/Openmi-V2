"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  describeRun,
  isTerminal,
  type ExecutionEventRow,
  type ExecutionRunRow,
  type RunDescription,
} from "@/lib/execution/status";

/**
 * The verification strip on a review card.
 *
 * It starts a run, polls the row, and renders the sentence that row supports.
 * There is no local success state: if the server has not recorded an exit code,
 * this panel says no result was recorded. A run that stops reporting says so.
 */

type Payload = {
  configured: boolean;
  run: ExecutionRunRow | null;
  events: ExecutionEventRow[];
  description?: RunDescription;
  error?: string;
};

const POLL_MS = 2_500;

export function ExecutionPanel({
  changesetId,
  status,
  autopilot = false,
}: {
  changesetId: string;
  status: string;
  /** Start the run without a click when the chat is in autopilot. */
  autopilot?: boolean;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const timerRef = useRef<number | null>(null);
  const autoStartedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/execution/runs?changesetId=${encodeURIComponent(changesetId)}`,
        { cache: "no-store" }
      );
      const body = (await response.json().catch(() => null)) as Payload | null;

      if (!response.ok) {
        if (body?.error) setError(body.error);
        return;
      }

      if (body) {
        setPayload(body);
        setError(null);
      }
    } catch {
      // A dropped poll is not a dropped run; the next tick asks again.
    }
  }, [changesetId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const run = payload?.run;
    if (!run || isTerminal(run.status)) return;

    timerRef.current = window.setTimeout(() => {
      void load();
    }, POLL_MS);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [payload, load]);

  async function start() {
    if (starting) return;
    setStarting(true);
    setError(null);

    try {
      const response = await fetch("/api/execution/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changesetId }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error ?? `The run could not start (${response.status}).`);
        return;
      }

      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The run could not start.");
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    const run = payload?.run;
    if (!run || cancelling) return;

    setCancelling(true);
    try {
      await fetch(`/api/execution/runs/${encodeURIComponent(run.id)}`, {
        method: "DELETE",
      });
      await load();
    } finally {
      setCancelling(false);
    }
  }

  // Autopilot starts exactly one run per card. The ref makes a re-render or a
  // reload that finds a fresh payload harmless, and a server that already has a
  // run keeps the decision instead of starting a second one.
  useEffect(() => {
    if (!autopilot || status !== "ready") return;
    if (!payload || payload.configured === false) return;
    if (payload.run || autoStartedRef.current) return;

    autoStartedRef.current = true;
    void start();
  }, [autopilot, status, payload]);

  const run = payload?.run ?? null;
  const description = payload?.description ?? describeRun(run);
  const live = run !== null && !isTerminal(run.status);
  const events = (payload?.events ?? []).slice(-8);

  const toneClass =
    description.tone === "accent"
      ? "border-accent/30 bg-accent/8 text-accent-text"
      : description.tone === "danger"
        ? "border-danger/25 bg-danger/8 text-danger"
        : description.tone === "warn"
          ? "border-warn/25 bg-warn/8 text-warn"
          : "border-line bg-raised text-mid";

  return (
    <section
      aria-label="Sandbox verification"
      className="space-y-2 border-t border-line pt-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">Sandbox</p>

        <div className="flex items-center gap-2">
          {live && (
            <button
              type="button"
              onClick={() => void cancel()}
              disabled={cancelling}
              className="btn px-3 py-0.5 text-[10.5px]"
            >
              {cancelling ? "Stopping…" : "Stop run"}
            </button>
          )}

          {status === "ready" && !live && (
            <button
              type="button"
              onClick={() => void start()}
              disabled={starting || payload?.configured === false}
              title={
                payload?.configured === false
                  ? "DAYTONA_API_KEY is not set on this deployment."
                  : undefined
              }
              className="btn px-3 py-0.5 text-[10.5px] disabled:opacity-50"
            >
              {starting ? "Starting…" : run ? "Run again" : "Install and build"}
            </button>
          )}
        </div>
      </div>

      <div className={`rounded-2xl border px-4 py-2.5 text-[11px] leading-relaxed ${toneClass}`}>
        <p className="font-medium">{description.title}</p>
        <p className="mt-0.5">{description.detail}</p>
        {description.charge && (
          <p className="mt-0.5 font-mono text-[10px] opacity-80">{description.charge}</p>
        )}

        {run?.install_command && (
          <p className="mt-1 font-mono text-[10px] opacity-80">
            install: {run.install_command}
          </p>
        )}
        {run?.build_command && (
          <p className="font-mono text-[10px] opacity-80">build: {run.build_command}</p>
        )}
        {typeof run?.exit_code === "number" && (
          <p className="font-mono text-[10px] opacity-80">exit: {run.exit_code}</p>
        )}
      </div>

      {payload?.configured === false && (
        <p className="text-[11px] leading-relaxed text-low">
          This deployment has no sandbox key, so nothing can run. The operator
          sets DAYTONA_API_KEY to turn it on.
        </p>
      )}

      {error && (
        <p role="alert" className="text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}

      {events.length > 0 && (
        <ul className="space-y-0.5 rounded-2xl border border-line bg-canvas px-3 py-2 font-mono text-[10px] leading-relaxed text-low">
          {events.map((event) => (
            <li key={event.seq} className="whitespace-pre-wrap break-words">
              <span aria-hidden="true">
                {event.kind === "status" ? "▸" : event.kind === "step" ? "·" : " "}
              </span>{" "}
              {event.body.slice(0, 400)}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10.5px] leading-relaxed text-low">
        The sandbox holds no tokens, no keys and no push credential. It reads a
        copy of this repository at {run ? "the pinned commit" : "the base commit"},
        applies the accepted files, and records the exit codes it saw. Nothing is
        written to GitHub from here.
      </p>
    </section>
  );
}
