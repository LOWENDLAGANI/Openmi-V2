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
 * A goal goes in, a terminal comes out. The poll advances the mission, so the
 * tab is what keeps it running: close it and the card says paused, because that
 * is true. Nothing here invents a result — every line is a command row the
 * server wrote before it ran.
 */

type Payload = {
  configured: boolean;
  mission: MissionRow | null;
  commands: MissionCommandRow[];
  description?: MissionDescription;
  caps?: { minutes: number; reserveDew: number };
  error?: string;
  advanced?: boolean;
};

const POLL_MS = 1_500;
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
  const [error, setError] = useState<string | null>(null);
  const ticking = useRef(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/missions?chatId=${encodeURIComponent(chatId)}`,
        { cache: "no-store" }
      );
      const body = (await response.json().catch(() => null)) as Payload | null;

      if (response.ok && body) {
        setPayload(body);
        setError(null);
        if (body.caps) setMinutes((current) => Math.min(current, body.caps!.minutes));
      } else if (body?.error) {
        setError(body.error);
      }
    } catch {
      // A dropped poll is not a dropped mission; the next tick asks again.
    }
  }, [chatId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tick = useCallback(async () => {
    const id = payload?.mission?.id;
    if (!id || ticking.current) return;

    ticking.current = true;
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
      // The mission row is the authority; a failed tick retries on the next poll.
    } finally {
      ticking.current = false;
    }
  }, [payload?.mission?.id]);

  useEffect(() => {
    const mission = payload?.mission;
    if (!mission || !LIVE.has(mission.status)) return;

    timer.current = window.setTimeout(() => {
      void tick();
    }, POLL_MS);

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [payload, tick]);

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
  const commands = payload?.commands ?? [];
  const live = mission ? LIVE.has(mission.status) : false;
  const description = payload?.description;
  const reserve = payload?.caps?.reserveDew ?? 1;

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium text-body">
          Mission · {repo.fullName.split("/")[1] ?? repo.fullName}
        </h2>
        <span className="text-[11px] text-low">
          {repositoryLabel(repo.sha, mission)}
        </span>
      </div>

      {payload?.configured === false && (
        <p className="mt-3 rounded-xl border border-line bg-page px-3 py-2 text-[12px] text-mid">
          Missions are off on this deployment. Set <code>MISSION_MODE_ENABLED=on</code>{" "}
          and <code>DAYTONA_API_KEY</code> to let the agent run commands.
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

      {commands.length > 0 && (
        <ol className="mt-3 max-h-[34vh] space-y-1 overflow-y-auto">
          {commands.map((command) => (
            <li key={command.seq} className="rounded-lg border border-line bg-page px-2 py-1.5">
              <div className="flex flex-wrap items-baseline gap-2 text-[11.5px]">
                <span className="text-low">{command.seq}</span>
                <span className="text-mid">{command.purpose}</span>
                <span
                  className={
                    command.exit_code === null
                      ? "text-mid"
                      : command.exit_code === 0
                        ? "text-accent-text"
                        : "text-danger"
                  }
                >
                  {commandLine(command)}
                </span>
              </div>

              {command.output_tail.trim().length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-low">
                    output{command.truncated ? " (tail)" : ""}
                  </summary>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10.5px] text-mid">
                    {command.output_tail}
                  </pre>
                </details>
              )}
            </li>
          ))}
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

function repositoryLabel(sha: string, mission: MissionRow | null): string {
  if (!mission) return sha.slice(0, 7);
  return `${sha.slice(0, 7)} · ${mission.commands_count} command(s)`;
}
