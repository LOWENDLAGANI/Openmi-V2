import { expect, test } from "bun:test";

import { utcToday } from "../lib/clock";
import { buildMissionPrompt } from "../lib/execution/mission/prompt";
import { MISSION_TOOL_SPECS } from "../lib/execution/mission/tools";
import {
  RUN_LIST_MAX,
  RUN_READ_MAX_LINES,
  RUN_SEARCH_MAX_HITS,
} from "../lib/runs/limits";
import { buildRunSystemPrompt } from "../lib/runs/prompt";
import { RUN_TOOL_NAMES, RUN_TOOL_SPECS } from "../lib/runs/tools";

/**
 * The prompt and the tool list are one contract.
 *
 * A tool the model is never told about is a tool it will not use, and a tool the
 * prompt names but the surface does not register is worse: the model calls it,
 * gets "unknown tool", and narrates a failure that did not happen. These cases
 * fail when either side moves without the other.
 */

const BASE = {
  repo: "LOWENDLAGANI/Openmi-V2",
  sha: "612f414",
  tree: ["app/page.tsx", "lib/runs/tools.ts"],
  instructions: null,
  today: "2026-11-17",
};

test("every registered run tool is named in the system prompt", () => {
  const prompt = buildRunSystemPrompt(BASE);

  for (const name of RUN_TOOL_NAMES) {
    expect(prompt).toContain(`- ${name}:`);
  }
});

test("the prompt names no tool the run surface does not register", () => {
  const prompt = buildRunSystemPrompt(BASE);

  // These belong to other surfaces (the mission sandbox, the retired agent
  // loop). A run that is told about them calls a name it cannot resolve.
  for (const absent of ["fetch_url", "browser", "propose_edits", "start_process"]) {
    expect(prompt).not.toContain(`- ${absent}:`);
  }

  expect(RUN_TOOL_SPECS.map((tool) => tool.name).sort()).toEqual(
    [...RUN_TOOL_NAMES].sort()
  );
});

test("the caps quoted in the prompt are the caps the tools enforce", () => {
  const prompt = buildRunSystemPrompt(BASE);

  expect(prompt).toContain(`${RUN_READ_MAX_LINES} lines`);
  expect(prompt).toContain(`${RUN_SEARCH_MAX_HITS} hits`);
  expect(prompt).toContain(`${RUN_LIST_MAX}`);
});

test("the prompt carries today's date and admits the knowledge cutoff", () => {
  const prompt = buildRunSystemPrompt(BASE);

  expect(prompt).toContain("Today is 2026-11-17 (UTC)");
  expect(prompt).toContain("training data ends before that date");
  // Where a current fact may be checked, rather than guessed.
  expect(prompt).toContain("lockfile");
  expect(prompt).toContain("npm view");
  expect(prompt).toContain("unverified");
});

test("the default date is the server's UTC date, not a constant", () => {
  expect(buildRunSystemPrompt({ ...BASE, today: undefined })).toContain(
    `Today is ${utcToday()} (UTC)`
  );
  expect(utcToday(new Date("2026-01-02T23:30:00Z"))).toBe("2026-01-02");
});

test("a prompt built for another day does not claim today's", () => {
  const prompt = buildRunSystemPrompt({ ...BASE, today: "2025-03-04" });

  expect(prompt).toContain("Today is 2025-03-04 (UTC)");
  expect(prompt).not.toContain("Today is 2026-11-17");
});

test("the mission prompt also knows the date and its process tools", () => {
  const prompt = buildMissionPrompt({
    goal: "Make the build pass",
    repo: "LOWENDLAGANI/Openmi-V2",
    sha: "612f414",
    autonomy: "act",
    workspace: "/work",
    remainingMs: 600_000,
    commandsUsed: 0,
    today: "2026-11-17",
  });

  expect(prompt).toContain("Today is 2026-11-17 (UTC)");
  expect(prompt).toContain("training data ends before that date");

  // The process controls are the ones a mission gets wrong: start a server,
  // never read it, never stop it. The prompt names all three, not just the
  // start, so the surface and the instructions agree.
  for (const name of ["run_command", "start_process", "read_process", "kill_process", "finish"]) {
    expect(prompt).toContain(name);
  }

  // Everything the mission surface registers is at least described to the
  // model: named in the prompt, or carried by the tool's own description.
  for (const tool of MISSION_TOOL_SPECS) {
    const named = prompt.includes(tool.name) || tool.description.length > 20;
    expect(named).toBe(true);
  }
});
