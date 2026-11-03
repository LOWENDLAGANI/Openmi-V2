"use client";

import { useEffect, useState } from "react";

import { ThinkingPill } from "@/components/Loading";

/**
 * What the assistant is doing, in words that are true.
 *
 * A real tool step wins: if the server said it is reading
 * `src/lib/session.ts`, that is the line shown, not a decoration. Otherwise the
 * copy rotates through three honest descriptions of the same wait. Nothing here
 * claims a verification step happened, a file was written, or a build finished.
 */

const IDLE_LINES = ["thinking", "reading the request", "composing the answer"] as const;

type Step = { detail: string; state: string };

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

  return <ThinkingPill label={label} />;
}
