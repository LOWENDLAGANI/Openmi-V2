"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StatusPill, type StatusTone } from "@/components/StatusPill";
import type { RuntimeSnapshot } from "@/lib/admin/runtime-types";

/**
 * The two processes a run depends on, in one place.
 *
 * The table is a monitor: it polls database counters every twenty seconds and
 * never contacts the provider, so leaving the panel open costs nothing. The
 * buttons are the deliberate tests — a worker health ping, and a sandbox test
 * that boots a real box, runs one command, then kills and deletes it before the
 * response comes back. The cleanup button exists for the box a crash left
 * between those steps.
 *
 * Nothing here reads a key. The panel shows presence, addresses and counters.
 */

const POLL_MS = 20_000;

type Action = "ping-worker" | "ping-sandbox" | "cleanup-sandboxes";

function tone(state: string | null | undefined): StatusTone {
  if (state === "ok") return "ok";
  if (state === "failed") return "missing";
  if (state === "unconfigured") return "optional";
  return "pending";
}

function ago(value: string | null, now: number | null): string {
  if (!value) return "never";

  const then = Date.parse(value);
  if (!Number.isFinite(then)) return "unknown";

  // The first render is the server's and the first client render must match
  // it, so relative text waits for the mount. Absolute UTC is the same string
  // on both sides.
  if (now === null) return `${value.slice(0, 16).replace("T", " ")} UTC`;

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

function millis(value: number | null): string {
  return value === null ? "—" : `${value}ms`;
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line py-1.5 first:border-0 first:pt-0">
      <span className="text-[11.5px] text-mid">{label}</span>
      <span className="min-w-0 break-all text-right font-mono text-[10.5px] text-low">
        {children}
      </span>
    </div>
  );
}

export function RuntimePanel({ initial }: { initial: RuntimeSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clock, setClock] = useState<number | null>(null);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/runtime", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as
        | { snapshot?: RuntimeSnapshot; error?: string }
        | null;

      if (response.ok && body?.snapshot) setSnapshot(body.snapshot);
    } catch {
      // A quiet poll that fails leaves the last good numbers on screen; the
      // manual buttons report their own failures.
    }
  }, []);

  useEffect(() => {
    setClock(Date.now());

    const ticking = window.setInterval(() => setClock(Date.now()), 15_000);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      void load();
    }, POLL_MS);

    return () => {
      window.clearInterval(ticking);
      window.clearInterval(timer);
    };
  }, [load]);

  async function run(action: Action) {
    if (busy !== null) return;

    busyRef.current = true;
    setBusy(action);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/admin/runtime", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });

      const body = (await response.json().catch(() => null)) as
        | {
            result?: { detail?: string };
            snapshot?: RuntimeSnapshot;
            error?: string;
          }
        | null;

      if (!response.ok || !body?.result) {
        setError(body?.error ?? "The test did not run.");
        return;
      }

      if (body.snapshot) setSnapshot(body.snapshot);
      setNotice(body.result.detail ?? "The test finished.");
    } catch {
      setError("The test request did not reach the server.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const workerProbe = snapshot.lastWorkerProbe;
  const sandboxProbe = snapshot.lastSandboxProbe;

  return (
    <section aria-labelledby="runtime-heading" className="panel mt-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="runtime-heading"
            className="text-[15px] font-semibold tracking-[-0.02em] text-hi"
          >
            Worker &amp; sandbox
          </h2>
          <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-mid">
            The queue&apos;s worker and the sandbox provider, monitored from the
            database and tested on demand. A sandbox test boots a real box, runs
            one command, then kills and deletes it before it returns.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={tone(workerProbe?.state)}>
            worker {workerProbe?.state ?? "untested"}
          </StatusPill>
          <StatusPill tone={tone(sandboxProbe?.state)}>
            sandbox {sandboxProbe?.state ?? "untested"}
          </StatusPill>
          <button
            type="button"
            onClick={() => void load()}
            className="btn px-3 py-1.5 text-[11px]"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="queued runs" value={String(snapshot.worker.queuedRuns)} />
        <Metric label="running runs" value={String(snapshot.worker.runningRuns)} />
        <Metric label="live chat boxes" value={String(snapshot.sandbox.live)} />
        <Metric label="due for wipe" value={String(snapshot.sandbox.due)} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <article className="rounded-2xl border border-line bg-raised p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold tracking-[-0.02em] text-hi">
              Worker
            </h3>
            <StatusPill tone={tone(workerProbe?.state)}>
              {workerProbe?.state ?? "untested"}
            </StatusPill>
          </div>

          <div className="mt-2">
            <Row label="Health URL">
              {snapshot.worker.healthUrl ?? "none configured"}
            </Row>
            <Row label="Wake pings on queue">
              {snapshot.worker.wakeEnabled ? "on" : "off"}
            </Row>
            <Row label="Last heartbeat">
              {ago(snapshot.worker.lastHeartbeatAt, clock)}
              {snapshot.worker.lastWorkerId
                ? ` · ${snapshot.worker.lastWorkerId}`
                : ""}
            </Row>
            <Row label="Live workers">
              {snapshot.worker.activeWorkers} with a running run
            </Row>
          </div>

          <div className="mt-3 rounded-xl border border-line bg-card px-3 py-2">
            {workerProbe ? (
              <>
                <p className="text-[11.5px] leading-relaxed text-body">
                  {workerProbe.detail}
                </p>
                <p className="mt-1 font-mono text-[10px] tabular-nums text-low">
                  HTTP {workerProbe.status ?? "—"} · {millis(workerProbe.latencyMs)}{" "}
                  · {ago(workerProbe.at, clock)}
                </p>
                {workerProbe.health && (
                  <p className="mt-1 font-mono text-[10px] tabular-nums text-low">
                    claimed {workerProbe.health.claimed ?? "—"} · finished{" "}
                    {workerProbe.health.finished ?? "—"} · failed{" "}
                    {workerProbe.health.failed ?? "—"} · concurrency{" "}
                    {workerProbe.health.concurrency ?? "—"} · up{" "}
                    {workerProbe.health.uptimeSeconds ?? "—"}s
                  </p>
                )}
              </>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-mid">
                Not tested from this panel yet.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void run("ping-worker")}
            disabled={busy !== null}
            aria-busy={busy === "ping-worker"}
            className="btn btn-primary mt-3 px-3.5 py-1.5 text-[11.5px]"
          >
            {busy === "ping-worker" ? "Pinging…" : "Ping worker"}
          </button>
        </article>

        <article className="rounded-2xl border border-line bg-raised p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold tracking-[-0.02em] text-hi">
              Sandbox
            </h3>
            <StatusPill tone={tone(sandboxProbe?.state)}>
              {sandboxProbe?.state ?? "untested"}
            </StatusPill>
          </div>

          <div className="mt-2">
            <Row label="E2B key">
              {snapshot.sandbox.configured ? "present" : "missing or disabled"}
            </Row>
            <Row label="Template">{snapshot.sandbox.template}</Row>
            <Row label="Egress">{snapshot.sandbox.networkMode}</Row>
            <Row label="Chat boxes">
              {snapshot.sandbox.live} live · {snapshot.sandbox.stopped} stopped ·{" "}
              {snapshot.sandbox.due} due
            </Row>
          </div>

          <div className="mt-3 rounded-xl border border-line bg-card px-3 py-2">
            {sandboxProbe ? (
              <>
                <p className="text-[11.5px] leading-relaxed text-body">
                  {sandboxProbe.detail}
                </p>
                <p className="mt-1 font-mono text-[10px] tabular-nums text-low">
                  create {millis(sandboxProbe.createMs)} · exec{" "}
                  {millis(sandboxProbe.execMs)} · exit{" "}
                  {sandboxProbe.exitCode ?? "—"} · teardown{" "}
                  {sandboxProbe.tornDown ?? "—"} · {ago(sandboxProbe.at, clock)}
                </p>
                {sandboxProbe.output && (
                  <p className="mt-1 truncate font-mono text-[10px] text-mid">
                    {sandboxProbe.output}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-mid">
                Not tested from this panel yet.
              </p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void run("ping-sandbox")}
              disabled={busy !== null}
              aria-busy={busy === "ping-sandbox"}
              className="btn btn-primary px-3.5 py-1.5 text-[11.5px]"
            >
              {busy === "ping-sandbox" ? "Booting…" : "Test sandbox"}
            </button>
            <button
              type="button"
              onClick={() => void run("cleanup-sandboxes")}
              disabled={busy !== null}
              aria-busy={busy === "cleanup-sandboxes"}
              className="btn px-3 py-1.5 text-[11px]"
              title="Destroy every box the sandbox test created and left behind."
            >
              {busy === "cleanup-sandboxes" ? "Killing…" : "Kill test boxes"}
            </button>
          </div>
        </article>
      </div>

      <p aria-live="polite" className="mt-3 min-h-4 text-[11.5px] leading-relaxed">
        {error ? (
          <span role="alert" className="text-danger">
            {error}
          </span>
        ) : notice ? (
          <span className="text-accent-text">{notice}</span>
        ) : (
          <span className="text-low">
            Polled every {POLL_MS / 1000}s · snapshot taken {ago(snapshot.at, clock)}.
            The worker is a separate process: this panel pings it and reads its
            queue, it does not start or stop it.
          </span>
        )}
      </p>
    </section>
  );
}
