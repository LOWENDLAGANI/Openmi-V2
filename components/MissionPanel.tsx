"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  commandLine,
  type MissionCommandRow,
  type MissionDescription,
  type MissionRow,
} from "@/lib/execution/mission/status";

/**
 * The mission panel.
 *
 * A goal goes in, a live terminal comes out. Two loops run at once: a one-second
 * read refreshes the ledger, and a tick advances the mission whenever the last
 * one has returned. That is what makes a command visible while it is happening
 * instead of in a batch four minutes later — the row is written before the
 * command runs, so the read sees it.
 *
 * The granularity is deliberate. A command appears the moment it starts and
 * gains its exit code and output when it ends; stdout is not streamed token by
 * token, because the sandbox reports it when the process exits.
 */

type Payload = {
  configured: boolean;
  mission: MissionRow | null;
  commands: MissionCommandRow[];
  description?: MissionDescription;
  caps?: { minutes: number; reserveDew: number };
  error?: string;
};

const POLL_MS = 1_000;
const LIVE = new Set(["queued", "running", "paused"]);

export function MissionPanel({
  chatId,
  repo,
}: {
  chatId: string;
  repo: { fullName: string; sha: string } | null;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [goal, setGoal] = useState("");
  const [autonomy, setAutonomy] = useState<"plan" | "act" | "ship">("act");
  const [minutes, setMinutes] = useState(20);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pinned, setPinned] = useState(true);
  const ticking = useRef(false);
  const listRef = useRef<HTMLOListElement | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      try {
        const response = await fetch(
          `/api/missions?chatId=${encodeURIComponent(chatId)}`,
          { cache: "no-store" }
        );
        const body = (await response.json().catch(() => null)) as Payload | null;

        if (response.ok && body) {
          setPayload(body);
          if (!quiet) setError(null);
          if (body.caps) setMinutes((current) => Math.min(current, body.caps!.minutes));
        } else if (body?.error && !quiet) {
          setError(body.error);
        }
      } catch {
        // A dropped poll is not a dropped mission; the next second asks again.
      }
    },
    [chatId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The composer is the usual way to start a mission, so the console has to
  // hear about one it did not start itself.
  useEffect(() => {
    function onStarted() {
      setPinned(true);
      void load();
    }

    window.addEventListener("openmi:mission-started", onStarted);
    return () => window.removeEventListener("openmi:mission-started", onStarted);
  }, [load]);

  const tick = useCallback(async (id: string) => {
    if (ticking.current) return;

    ticking.current = true;
    setInFlight(true);

    try {
      const response = await fetch(`/api/missions/${encodeURIComponent(id)}/tick`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as Payload | null;

      if (response.ok && body?.mission) {
        setPayload((current) => ({
          configured: current?.configured ?? true,
          mission: body.mission,
          commands: body.commands,
          description: body.description,
          caps: current?.caps,
        }));
        setError(null);
      } else if (body?.error) {
        setError(body.error);
      }
    } catch {
      // The row is the authority; a failed tick retries on the next interval.
    } finally {
      ticking.current = false;
      setInFlight(false);
    }
  }, []);

  const missionId = payload?.mission?.id ?? null;
  const missionStatus = payload?.mission?.status ?? null;
  const live = missionStatus ? LIVE.has(missionStatus) : false;

  // One interval drives both halves: read what happened, then advance if the
  // previous tick has returned. Keyed on id and status only, so a refresh cannot
  // keep resetting the tick timer and stalling the mission.
  useEffect(() => {
    if (!missionId || !missionStatus || !LIVE.has(missionStatus)) return;

    if (!ticking.current) void tick(missionId);

    const timer = window.setInterval(() => {
      void load(true);
      if (!ticking.current) void tick(missionId);
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [missionId, missionStatus, tick, load]);

  useEffect(() => {
    if (!live) return;

    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live]);

  const commands = payload?.commands ?? [];
  const commandCount = commands.length;

  useEffect(() => {
    if (!pinned || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [commandCount, pinned]);

  async function start() {
    if (starting) return;

    const text = goal.trim();
    if (text.length < 3) {
      setError("Describe the goal first.");
      return;
    }

    setStarting(true);
    setError(null);

    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId, goal: text, autonomy, minutes }),
      });
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error ?? `The mission could not start (${response.status}).`);
        return;
      }

      setGoal("");
      setPinned(true);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The mission could not start.");
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    const id = payload?.mission?.id;
    if (!id || stopping) return;

    setStopping(true);
    try {
      await fetch(`/api/missions/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setStopping(false);
    }
  }

  if (!repo) {
    return (
      <p className="rounded-2xl border border-line bg-card px-4 py-3 text-[12px] text-mid">
        Attach a repository to give the agent a goal.
      </p>
    );
  }

  const mission = payload?.mission ?? null;
  const description = payload?.description;
  const reserve = payload?.caps?.reserveDew ?? 1;
  const running = commands.find((command) => command.exit_code === null) ?? null;
  const elapsed = mission ? Math.max(0, now - new Date(mission.started_at).getTime()) : 0;

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-body">
          Mission · {repo.fullName.split("/")[1] ?? repo.fullName}
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-normal text-accent-text">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" />
              live
            </span>
          )}
        </h2>
        <span className="text-[11px] text-low">
          {live
            ? `${clock(elapsed)} elapsed · ${commandCount} command(s)`
            : `${repo.sha.slice(0, 7)} · ${commandCount} command(s)`}
        </span>
      </div>

      {payload?.configured === false && (
        <p className="mt-3 rounded-xl border border-line bg-page px-3 py-2 text-[12px] text-mid">
          The sandbox is not configured on this deployment. Set{" "}
          <code>DAYTONA_API_KEY</code> to give the agent an environment to work
          in.
        </p>
      )}

      {!live && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            rows={2}
            maxLength={4_000}
            placeholder="Give the agent a goal: “make the landing page build cleanly, then fix the failing typecheck”"
            className="w-full resize-y rounded-xl border border-line bg-page px-3 py-2 text-[13px] text-body outline-none focus:border-accent"
          />

          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-mid">
            <label className="flex items-center gap-1">
              Autonomy
              <select
                value={autonomy}
                onChange={(event) =>
                  setAutonomy(event.target.value as "plan" | "act" | "ship")
                }
                className="rounded-lg border border-line bg-page px-2 py-1 text-body"
              >
                <option value="plan">plan — read only</option>
                <option value="act">act — diff for review</option>
                <option value="ship">ship — open the PR if checks exit 0</option>
              </select>
            </label>

            <label className="flex items-center gap-1">
              Minutes
              <select
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
                className="rounded-lg border border-line bg-page px-2 py-1 text-body"
              >
                {[5, 10, 20, 30]
                  .filter((value) => value <= (payload?.caps?.minutes ?? 30))
                  .map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
              </select>
            </label>

            <span className="text-low">{reserve} Dew reserved</span>

            <button
              type="button"
              onClick={() => void start()}
              disabled={starting || payload?.configured === false}
              className="ml-auto rounded-xl bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent disabled:opacity-50"
            >
              {starting ? "Starting…" : "Start mission"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
          {error}
        </p>
      )}

      {mission && description && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-[12.5px] font-medium text-body">{description.title}</span>
          <span className="text-[11.5px] text-mid">{description.detail}</span>
          {live && (
            <button
              type="button"
              onClick={() => void stop()}
              disabled={stopping}
              className="ml-auto rounded-lg border border-line px-2 py-1 text-[11.5px] text-mid hover:text-body disabled:opacity-50"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
        </div>
      )}

      {live && !running && (
        <p className="mt-3 flex items-center gap-2 text-[11.5px] text-mid">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          {inFlight
            ? "The agent is deciding the next step…"
            : commands.length === 0
              ? "Preparing the sandbox and seeding the repository…"
              : "Thinking…"}
        </p>
      )}

      {commands.length > 0 && (
        <ol
          ref={listRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            const distance =
              element.scrollHeight - element.scrollTop - element.clientHeight;
            setPinned(distance < 24);
          }}
          className="mt-3 max-h-[34vh] space-y-1 overflow-y-auto"
        >
          {commands.map((command) => {
            const isRunning = command.exit_code === null;

            return (
              <li
                key={command.seq}
                className={`rounded-lg border px-2 py-1.5 ${
                  isRunning ? "border-accent/50 bg-accent-soft/40" : "border-line bg-page"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-2 text-[11.5px]">
                  <span className="text-low">{command.seq}</span>
                  <span className="text-mid">{command.purpose}</span>
                  <span
                    className={
                      isRunning
                        ? "inline-flex items-center gap-1 text-accent-text"
                        : command.exit_code === 0
                          ? "text-accent-text"
                          : "text-danger"
                    }
                  >
                    {isRunning && (
                      <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                    )}
                    {commandLine(command)}
                  </span>
                  <span className="ml-auto text-[10px] text-low">
                    {timeOf(command.at)}
                  </span>
                </div>

                {command.output_tail.trim().length > 0 && (
                  <details className="mt-1" open={isRunning}>
                    <summary className="cursor-pointer text-[11px] text-low">
                      output{command.truncated ? " (tail)" : ""}
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10.5px] text-mid">
                      {command.output_tail}
                    </pre>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {mission?.result_changeset_id && (
        <p className="mt-3 text-[11.5px] text-mid">
          The collected diff is on the review card above. Nothing was written to
          GitHub.
        </p>
      )}
    </section>
  );
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function timeOf(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
