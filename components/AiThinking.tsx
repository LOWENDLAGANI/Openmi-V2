"use client";

import { useEffect, useState } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";

import { ThinkingPill } from "@/components/Loading";
import { useAppTheme } from "@/components/useAppTheme";

/**
 * What the assistant is doing, in words that are true.
 *
 * A real tool step wins: if the server said it is reading
 * `src/lib/session.ts`, that is the line shown, not a decoration. Otherwise the
 * copy rotates through three honest descriptions of the same wait. Nothing here
 * claims a verification step happened, a file was written, or a build finished.
 *
 * The orb is chosen the same way — from the tool that is actually running — so
 * the animation cannot imply work the transcript does not show.
 */

const IDLE_LINES = ["thinking", "reading the request", "composing the answer"] as const;

type Step = { detail: string; state: string; tool?: string };

/**
 * The animation that matches the tool in flight.
 *
 * The keys are the tool names this app registers rather than a second
 * vocabulary: a read is a scan, an edit is shaping, a command is work, a browser
 * is connecting. No step yet means one wait with rotating words, and a calm
 * breathing ring is the truthful picture of that.
 */
const ORB_BY_TOOL: Record<string, OrbState> = {
  read_file: "searching",
  list_files: "searching",
  search_code: "searching",
  fetch_url: "searching",
  propose_edits: "shaping",
  write_file: "shaping",
  run_command: "working",
  start_process: "working",
  read_process: "working",
  kill_process: "working",
  browser: "connecting",
};

function orbState(step: Step | undefined, backgroundRunning: boolean): OrbState {
  if (!step) return backgroundRunning ? "working" : "breathing";

  return ORB_BY_TOOL[step.tool ?? ""] ?? "working";
}

export function AiThinking({
  steps,
  streaming,
  backgroundRunning,
}: {
  steps: Step[];
  streaming: boolean;
  backgroundRunning: boolean;
}) {
  const [index, setIndex] = useState(0);
  const theme = useAppTheme();

  const latest = [...steps].reverse().find((step) => step.state !== "done");
  const stepLabel = latest?.detail?.trim() ?? "";

  useEffect(() => {
    if (stepLabel.length > 0) return;

    const id = setInterval(() => {
      setIndex((current) => (current + 1) % IDLE_LINES.length);
    }, 2_600);

    return () => clearInterval(id);
  }, [stepLabel]);

  let label: string;

  if (backgroundRunning && !streaming) {
    label = "still working on the server";
  } else if (stepLabel.length > 0) {
    label = stepLabel;
  } else {
    label = IDLE_LINES[index] ?? "thinking";
  }

  return (
    <ThinkingPill
      label={label}
      icon={
        <ThinkingOrb
          state={orbState(latest, backgroundRunning && !streaming)}
          size={20}
          theme={theme}
          aria-hidden="true"
        />
      }
    />
  );
}
