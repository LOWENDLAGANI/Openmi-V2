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

  test("nothing is provisioned until a tool is actually called", () => {
    const sandbox = read("lib/agent/sandbox.ts");

    // The create call lives inside `ensure`, which only `run` reaches.
    const ensureAt = sandbox.indexOf("async function ensure()");
    const createAt = sandbox.indexOf("await createSandbox(");
    const runAt = sandbox.indexOf("async function run(");

    expect(ensureAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(ensureAt);
    expect(runAt).toBeGreaterThan(createAt);
    expect(sandbox).toContain("await ensure()");
  });

  test("the model is told it has a shell, and the old denial is not sent with it", () => {
    const prompt = read("lib/prompt.ts");

    expect(prompt).toContain("SHELL_CLAUSE");
    // The old denial clause was removed when the prompt switched to shell-first.
    expect(prompt).not.toContain("NO_EXECUTION_CLAUSE");
    expect(prompt).toContain("/bin/sh otherwise");

    // The run's prompt is the one that describes the workspace now, and it
    // always has a shell: a run cannot start without a sandbox.
    expect(read("lib/runs/prompt.ts")).toContain("run_command");
    expect(read("app/api/chat/route.ts")).not.toContain("shell: Boolean(shellTurn)");
  });

  test("a shell supersedes the repository reads it can do itself", () => {
    const run = read("lib/agent/run.ts");

    // Two tools with one name would reach the provider twice with different
    // parameters, and the dispatch would quietly prefer the sandbox.
    expect(run).toContain(
      "TOOL_SPECS.filter((tool) => !shellNames.has(tool.name))"
    );
  });

  test("the transcript folds a step instead of printing a log", () => {
    const panel = read("components/ChatPanel.tsx");

    expect(panel).toContain("function StepList(");
    expect(panel).toContain("agent-step-command");
    expect(panel).toContain("steps: [...stepLog]");
  });
});
