import { expect, test } from "bun:test";

import type { SandboxHandle } from "../lib/execution/provider";
import { executeRunTool } from "../lib/runs/tools";

/**
 * A command killed by a stop is not a command that exited.
 *
 * The console used to show whatever the tool's own timeout produced, which for a
 * cancelled install was two minutes of a stopped button and then "exit 124".
 * These pin what the model and the reader see instead.
 */

const killed = {
  exec: async () => ({
    command: "npm install",
    exitCode: 137,
    output: "added 3 packages\n",
    truncated: false,
    durationMs: 1_200,
    timedOut: false,
    stopped: true,
  }),
} as unknown as SandboxHandle;

test("a killed command says it was stopped, and keeps what it printed", async () => {
  const result = await executeRunTool({
    name: "run_command",
    args: { command: "npm install", purpose: "install dependencies" },
    sandbox: killed,
    github: null,
  });

  expect(result.text).toContain("The reader stopped this run");
  expect(result.text).toContain("added 3 packages");
  expect(result.preview).toContain("killed");
  expect(result.isError).toBe(true);
});

test("the run's stop signal reaches the sandbox's exec", async () => {
  const seen: Array<AbortSignal | undefined> = [];

  const sandbox = {
    exec: async (
      _command: string,
      _cwd?: string,
      _timeoutMs?: number,
      signal?: AbortSignal
    ) => {
      seen.push(signal);
      return {
        command: "bun test",
        exitCode: 0,
        output: "ok\n",
        truncated: false,
        durationMs: 10,
        timedOut: false,
      };
    },
  } as unknown as SandboxHandle;

  const controller = new AbortController();

  await executeRunTool({
    name: "run_command",
    args: { command: "bun test", purpose: "run the tests" },
    sandbox,
    github: null,
    signal: controller.signal,
  });

  expect(seen.length).toBe(1);
  expect(seen[0]).toBe(controller.signal);
});
