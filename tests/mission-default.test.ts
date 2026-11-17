import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The product decision this file pins: one composer.
 *
 * There is no mode to pick and no second surface to watch. A message is sent to
 * the chat turn, and whether it needs a shell is the model's decision, made by
 * calling a tool or not calling one.
 */

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("one composer decides nothing about modes", () => {
  test("the composer sends every message to the chat turn", () => {
    const panel = read("components/ChatPanel.tsx");

    expect(panel).toContain('fetch("/api/chat"');
    expect(panel).not.toContain("/api/missions");
    expect(panel).not.toContain("missionDefault");
    expect(panel).not.toContain("startMission");
  });

  test("the chat page has no mission console above the conversation", () => {
    const page = read("app/chat/page.tsx");

    expect(page).not.toContain("MissionPanel");
    expect(page).not.toContain("missionDefault");
    expect(existsSync(join(root, "components/MissionPanel.tsx"))).toBe(false);
  });

  test("the turn is a run, and the run owns the sandbox", () => {
    const route = read("app/api/chat/route.ts");

    // The route queues a run; the worker opens the workspace behind it.
    expect(route).toContain("createRun(admin");
    expect(read("lib/runs/loop.ts")).toContain("openRunWorkspace(");

    // A message that runs commands needs a streaming ceiling, not 60 s.
    expect(route).toContain("export const maxDuration = 300");
  });

  test("the model is told about the shell it actually has", () => {
    // The composer that runs is the run's, and it always has a sandbox: a run
    // cannot start without one. The retired GitHub-only prompt is not shipped.
    const prompt = read("lib/runs/prompt.ts");

    expect(prompt).toContain("run_command");
    expect(existsSync(join(root, "lib/prompt.ts"))).toBe(false);
    expect(read("app/api/chat/route.ts")).not.toContain("shell: Boolean(shellTurn)");
  });

  test("the transcript folds a step instead of printing a log", () => {
    const panel = read("components/ChatPanel.tsx");

    expect(panel).toContain("function StepList(");
    expect(panel).toContain("agent-step-command");
    expect(panel).toContain("steps: [...stepLog]");
  });
});
