"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RunSnapshotWithDiff } from "@/lib/runs/snapshot";

/**
 * A run, rendered from server events only.
 *
 * State is rebuilt from two sources and nothing else: the snapshot the page
 * was served (`runs.status` plus the transcript and its tool calls) and the SSE
 * frames appended after it. There is no local state machine that can disagree
 * with the server — reloading mid-stream replays the log and lands in the same
 * place.
 *
 * Chain-of-thought is not in this protocol. What the reader sees between text
 * deltas is the tool summary: "editing src/app/page.tsx", then its exit or its
 * preview.
 */

type ToolRow = {
  key: string;
  name: string;
  summary: string;
  state: "running" | "done" | "error";
  preview: string | null;
  durationMs: number | null;
};

type Usage = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

function textOf(content: unknown): string {
  if (content && typeof content === "object" && "text" in content) {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }
  return "";
}

function parseFrame(raw: string): {
  id: number;
  event: string;
  data: Record<string, unknown>;
} | null {
  let id = 0;
  let event = "";
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("id:")) id = Number(line.slice(3).trim()) || 0;
    else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  if (event.length === 0) return null;

  try {
    const parsed = dataLines.length > 0 ? (JSON.parse(dataLines.join("\n")) as unknown) : {};
    return {
      id,
      event,
      data:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
    };
  } catch {
    return null;
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function RunView({ initial }: { initial: RunSnapshotWithDiff }) {
  const runId = initial.run.id;

  const [status, setStatus] = useState<string>(initial.run.status);
  const [stopReason, setStopReason] = useState<string | null>(initial.run.stop_reason);
  const [error, setError] = useState<string | null>(initial.run.error);
  const [warning, setWarning] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [answer, setAnswer] = useState<string[]>(() =>
    initial.messages
      .filter((message) => message.role === "assistant")
      .map((message) => textOf(message.content_json))
      .filter((text) => text.length > 0)
  );
  const [tools, setTools] = useState<ToolRow[]>(() =>
    initial.toolCalls.map((call, index) => ({
      key: `${call.step_idx}-${call.idx}-${index}`,
      name: call.name,
      summary: call.name,
      state: call.is_error ? "error" : "done",
      preview: textOf(call.result_json).slice(0, 400) || null,
      durationMs: call.duration_ms,
    }))
  );
  const [usage, setUsage] = useState<Usage>({
    inputTokens: initial.run.input_tokens,
    outputTokens: initial.run.output_tokens,
    costUsd: initial.run.cost_usd,
  });
  const [diff, setDiff] = useState<string | null>(initial.diff);
  const [files, setFiles] = useState<string[]>(
    initial.artifacts.filter((artifact) => artifact.kind === "file").map((artifact) => artifact.path)
  );
  const [connection, setConnection] = useState<"live" | "reconnecting" | "closed">("live");
  const [cancelling, setCancelling] = useState(initial.run.cancel_requested);

  const finishedRef = useRef(
    initial.run.status !== "queued" && initial.run.status !== "running"
  );
  const [finished, setFinished] = useState(finishedRef.current);
  // The streamed text of the current step. A ref because the flush happens
  // from inside a frame handler, where reading state would see a stale value.
  const liveRef = useRef("");

  const flushLive = useCallback(() => {
    const text = liveRef.current;
    liveRef.current = "";
    setLive("");
    if (text.length > 0) setAnswer((list) => [...list, text]);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    try {
      const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as RunSnapshotWithDiff;
      setDiff(body.diff ?? null);
      setFiles(
        body.artifacts.filter((artifact) => artifact.kind === "file").map((artifact) => artifact.path)
      );
    } catch {
      // The stream already carried the result; a missing diff is reported by
      // the panel rather than by an error here.
    }
  }, [runId]);

  const apply = useCallback(
    (frame: { event: string; data: Record<string, unknown> }) => {
      const { event, data } = frame;

      if (event === "run.started") {
        setStatus("running");
        return;
      }

      if (event === "message.delta") {
        const text = typeof data.text === "string" ? data.text : "";
        if (text.length > 0) {
          liveRef.current += text;
          setLive(liveRef.current);
        }
        return;
      }

      if (event === "message.done") {
        flushLive();
        return;
      }

      if (event === "tool.started") {
        const name = typeof data.name === "string" ? data.name : "tool";
        const summary = typeof data.summary === "string" ? data.summary : name;
        setTools((list) => [
          ...list,
          {
            key: `${name}-${list.length}-${Date.now()}`,
            name,
            summary,
            state: "running",
            preview: null,
            durationMs: null,
          },
        ]);
        return;
      }

      if (event === "tool.finished") {
        const name = typeof data.name === "string" ? data.name : "tool";
        setTools((list) => {
          const next = [...list];
          for (let index = next.length - 1; index >= 0; index -= 1) {
            if (next[index].state === "running" && next[index].name === name) {
              next[index] = {
                ...next[index],
                state: data.isError === true ? "error" : "done",
                preview: typeof data.resultPreview === "string" ? data.resultPreview : null,
                durationMs: numberOrZero(data.durationMs),
              };
              return next;
            }
          }
          return next;
        });
        return;
      }

      if (event === "usage") {
        setUsage((current) => ({
          inputTokens: numberOrZero(data.inputTokens) || current.inputTokens,
          outputTokens: numberOrZero(data.outputTokens) || current.outputTokens,
          costUsd:
            typeof data.costUsd === "number" && Number.isFinite(data.costUsd)
              ? data.costUsd
              : current.costUsd,
        }));
        return;
      }

      if (event === "warning") {
        setWarning(typeof data.message === "string" ? data.message : "A limit was reached.");
        return;
      }

      if (event === "run.finished") {
        setStatus(typeof data.status === "string" ? data.status : "done");
        setStopReason(typeof data.stopReason === "string" ? data.stopReason : null);
        flushLive();
        finishedRef.current = true;
        setFinished(true);
        void refreshSnapshot();
        return;
      }

      if (event === "run.error") {
        setStatus("failed");
        setError(typeof data.message === "string" ? data.message : "The run failed.");
        flushLive();
        finishedRef.current = true;
        setFinished(true);
        void refreshSnapshot();
      }
    },
    [flushLive, refreshSnapshot]
  );

  useEffect(() => {
    let disposed = false;
    let cursor = 0;
    let retry = 0;
    let controller: AbortController | null = null;

    if (finishedRef.current) {
      setConnection("closed");
      return;
    }

    const pump = async () => {
      while (!disposed && !finishedRef.current) {
        controller = new AbortController();
        setConnection(retry === 0 ? "live" : "reconnecting");

        try {
          const response = await fetch(`/api/runs/${runId}/stream?after=${cursor}`, {
            cache: "no-store",
            signal: controller.signal,
          });

          if (response.status === 401 || response.status === 404) {
            setConnection("closed");
            return;
          }

          if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!disposed) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.indexOf("\n\n");

            while (boundary >= 0) {
              const frame = parseFrame(buffer.slice(0, boundary));
              buffer = buffer.slice(boundary + 2);

              if (frame) {
                cursor = Math.max(cursor, frame.id);
                retry = 0;
                if (!disposed) apply(frame);
              }

              boundary = buffer.indexOf("\n\n");
            }
          }
        } catch {
          if (disposed) return;
        }

        if (finishedRef.current || disposed) break;

        retry += 1;
        setConnection("reconnecting");
        await new Promise((resolve) => setTimeout(resolve, Math.min(4_000, 400 * retry)));
      }

      if (!disposed) setConnection("closed");
    };

    void pump();

    return () => {
      disposed = true;
      controller?.abort();
    };
  }, [apply, runId]);

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);

    try {
      const response = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        setWarning(body?.message ?? "The run could not be cancelled.");
        setCancelling(false);
      } else {
        setWarning(body?.message ?? "Cancellation requested.");
      }
    } catch {
      setWarning("The cancellation request did not reach the server.");
      setCancelling(false);
    }
  }

  const liveStatus = status === "queued" || status === "running";
  const tokens = usage.inputTokens + usage.outputTokens;

  const labels: Record<string, string> = {
    queued: "Queued",
    running: "Running",
    done: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
    blocked: "Stopped at a limit",
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-line bg-raised px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.14em] text-low">Run</p>
          <p className="truncate text-[13px] text-hi">{runId}</p>
          <p className="mt-1 text-[12px] text-low">
            {initial.run.model} · step {Math.max(0, tools.length)} ·{" "}
            {tokens.toLocaleString()} tokens · ${usage.costUsd.toFixed(6)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-line px-3 py-1 text-[12px] text-hi">
            {labels[status] ?? status}
          </span>
          {liveStatus ? (
            <button
              type="button"
              onClick={cancel}
              disabled={cancelling}
              className="rounded-full border border-line px-3 py-1 text-[12px] text-hi disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Cancel"}
            </button>
          ) : null}
        </div>
      </header>

      {warning ? (
        <p className="rounded-2xl border border-line bg-accent-soft px-4 py-3 text-[12px] text-hi">
          {warning}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-2xl border border-line bg-accent-soft px-4 py-3 text-[12px] text-hi"
        >
          {error}
        </p>
      ) : null}

      <section className="rounded-3xl border border-line bg-raised px-5 py-4">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-low">Transcript</h2>

        {answer.length === 0 && live.length === 0 ? (
          <p className="mt-3 text-[13px] text-low">
            {liveStatus
              ? "The agent has not written anything yet. Tool calls appear below as they happen."
              : "This run produced no answer text."}
          </p>
        ) : null}

        <div className="mt-3 flex flex-col gap-3">
          {answer.map((text, index) => (
            <p
              key={`answer-${index}`}
              className="whitespace-pre-wrap break-words text-[14px] leading-6 text-hi [overflow-wrap:anywhere]"
            >
              {text}
            </p>
          ))}

          {live.length > 0 ? (
            <p className="whitespace-pre-wrap break-words text-[14px] leading-6 text-hi [overflow-wrap:anywhere]">
              {live}
              <span className="stream-caret" aria-hidden="true" />
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-raised px-5 py-4">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-low">Work</h2>

        {tools.length === 0 ? (
          <p className="mt-3 text-[13px] text-low">No tool has run yet.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-2">
            {tools.map((tool) => (
              <li key={tool.key} className="rounded-2xl border border-line px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] text-hi [overflow-wrap:anywhere]">
                    {tool.summary}
                  </span>
                  <span className="text-[11px] text-low">
                    {tool.state === "running"
                      ? "running"
                      : tool.state === "error"
                        ? "failed"
                        : "done"}
                    {tool.durationMs !== null ? ` · ${tool.durationMs} ms` : ""}
                  </span>
                </div>
                {tool.preview ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-low [overflow-wrap:anywhere]">
                    {tool.preview}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-3xl border border-line bg-raised px-5 py-4">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-low">Diff</h2>

        {files.length > 0 ? (
          <p className="mt-2 text-[12px] text-low">{files.join(", ")}</p>
        ) : null}

        {diff ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] text-hi">Unified diff</summary>
            <pre className="mt-2 max-h-[28rem] overflow-auto rounded-2xl border border-line bg-canvas p-3 text-[12px] leading-5 text-hi">
              {diff}
            </pre>
          </details>
        ) : (
          <p className="mt-2 text-[13px] text-low">
            {finished
              ? "No diff was recorded for this run."
              : "The diff appears when the run finishes; nothing is pushed from the sandbox."}
          </p>
        )}
      </section>

      <p className="px-1 text-[11px] text-low">
        {connection === "live"
          ? "Streaming server events."
          : connection === "reconnecting"
            ? "Reconnecting; the run continues on the server."
            : stopReason
              ? `Stream closed (${stopReason}). Reload to replay the full log.`
              : "Stream closed. Reload to replay the full log."}
      </p>
    </div>
  );
}
