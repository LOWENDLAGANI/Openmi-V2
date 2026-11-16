import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { resumeInstruction } from "../lib/runs/prompt";

/**
 * A run interrupted by a worker restart is resumed, not restarted.
 *
 * The workspace and the transcript survive a deploy; the tool results the model
 * had read do not. These pin the two halves of that: the note the second attempt
 * is given, and the wiring that keeps its disk instead of seeding a new one.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("a resumed run is told where it stopped and what it had run", () => {
  const note = resumeInstruction({
    steps: 14,
    recent: [
      { name: "run_command", detail: "running npm install" },
      { name: "edit_file", detail: "editing next.config.mjs" },
      { name: "run_command", detail: "running npm test", failed: true },
    ],
  });

  expect(note).toContain("after 14 steps");
  expect(note).toContain("running npm install");
  expect(note).toContain("failed: running npm test");
  expect(note).toContain("Do not redo finished work");
  expect(note).toContain("read the workspace");
});

test("a run with no tools behind it is not given an empty list", () => {
  const note = resumeInstruction({ steps: 1, recent: [] });

  expect(note).toContain("after 1 step.");
  expect(note).not.toContain("What it did last");
});

test("the loop resumes on the recorded box and continues the transcript", () => {
  const loop = read("lib/runs/loop.ts");

  expect(loop).toContain("const resumed = run.retry_count > 0 || run.steps > 0;");
  expect(loop).toContain("sandboxId: run.sandbox_id");
  expect(loop).toContain("resumeInstruction({");
  expect(loop).toContain("listRunToolCalls(admin, runId)");
});

test("the workspace layer reattaches instead of seeding a second box", () => {
  const sandbox = read("lib/runs/sandbox.ts");

  expect(sandbox).toContain("resumeRecordedWorkspace(input)");
  expect(sandbox).toContain("attachSandbox(input.sandboxId, input.sandboxAccount)");
});

test("the answer's reasoning is stored, and streamed on its own channel", () => {
  // Stored: without it a reloaded answer had no thinking fold at all.
  expect(read("lib/runs/chat.ts")).toContain("p_thinking: thinking");
  expect(read("lib/runs/loop.ts")).toContain('"message.reasoning"');
  expect(read("app/api/chat/route.ts")).toContain('send("reasoning"');
});
