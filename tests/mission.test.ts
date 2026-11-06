import { describe, expect, test } from "bun:test";

import {
  chargeMissionDuration,
  missionCaps,
  missionDeadline,
  missionExpired,
  missionMinutes,
  missionReserveDew,
  remainingMs,
  stalledAfter,
} from "../lib/execution/mission/budget";
import { describeMission, type MissionRow } from "../lib/execution/mission/status";
import {
  MISSION_TOOL_SPECS,
  missionOutput,
  sanitiseWorkspacePath,
  shellQuote,
  toolsForAutonomy,
  validateCommandArguments,
  validateFinish,
} from "../lib/execution/mission/tools";

/**
 * The rules mission mode must keep, asserted without a sandbox.
 *
 * The important ones are negative: a claim of a passing check that was never
 * run is refused, a path cannot leave the workspace, and no card can reach a
 * success sentence without a collected diff. A real sandbox test needs a
 * sandbox provider key and is deliberately not pretended here.
 */

describe("mission budget", () => {
  test("a mission that never started costs nothing", () => {
    expect(chargeMissionDuration(0, 20)).toBe(0);
    expect(chargeMissionDuration(-1, 20)).toBe(0);
  });

  test("a started minute is charged, rounded up, and capped at the reserve", () => {
    expect(chargeMissionDuration(1_000, 20)).toBe(0.05);
    expect(chargeMissionDuration(61_000, 20)).toBe(0.1);
    expect(chargeMissionDuration(20 * 60_000, 20)).toBe(1);
    expect(chargeMissionDuration(60 * 60_000, 20)).toBe(1);
  });

  test("the reserve is the rate times the chosen minutes", () => {
    expect(missionReserveDew(20)).toBe(1);
    expect(missionReserveDew(5)).toBe(0.25);
    expect(missionReserveDew(90)).toBe(1.5);
  });

  test("a mis-set env cannot buy an hour", () => {
    expect(missionMinutes({ EXEC_MISSION_MINUTES: "99" })).toBe(30);
    expect(missionMinutes({ EXEC_MISSION_MINUTES: "0" })).toBe(1);
    expect(missionMinutes({ EXEC_MISSION_MINUTES: "nonsense" })).toBe(20);
    expect(missionCaps({ EXEC_MISSION_MINUTES: "10" }).reserveDew).toBe(0.5);
  });

  test("a deadline in the past is expired, and a missing one is too", () => {
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    const deadline = missionDeadline(start, 10);

    expect(remainingMs(deadline, start + 60_000)).toBe(9 * 60_000);
    expect(missionExpired(deadline, start + 11 * 60_000)).toBe(true);
    expect(missionExpired(deadline, start)).toBe(false);
    expect(missionExpired(null)).toBe(true);
  });

  test("stalling needs two empty ticks, not one", () => {
    expect(stalledAfter(1)).toBe(false);
    expect(stalledAfter(2)).toBe(true);
  });
});

describe("mission tools", () => {
  test("the shell tool requires a purpose and passes the command through unchanged", () => {
    const missing = validateCommandArguments({ command: "ls" });
    expect(missing.ok).toBe(false);

    const valid = validateCommandArguments({
      purpose: "list files",
      command: "ls -la && echo 'hi'",
    });

    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    // Not rewritten, not split, not quoted by the validator: the sandbox gets
    // exactly what the model asked for.
    expect(valid.command).toBe("ls -la && echo 'hi'");
    expect(valid.timeoutMs).toBe(120_000);
  });

  test("a path cannot leave the workspace", () => {
    expect(sanitiseWorkspacePath("../../etc/passwd")).toBeNull();
    expect(sanitiseWorkspacePath("/etc/passwd")).toBeNull();
    expect(sanitiseWorkspacePath(".git/config")).toBeNull();
    expect(sanitiseWorkspacePath("openmi-workspace/x")).toBeNull();
    expect(sanitiseWorkspacePath("src/app.tsx")).toBe("src/app.tsx");
  });

  test("no tool takes a URL", () => {
    for (const tool of MISSION_TOOL_SPECS) {
      const properties = (tool.parameters as { properties?: Record<string, unknown> })
        .properties;
      expect(Object.keys(properties ?? {})).not.toContain("url");
    }
  });

  test("plan mode offers no writing tool", () => {
    const names = toolsForAutonomy("plan").map((tool) => tool.name);
    expect(names).not.toContain("write_file");
    expect(names).toContain("run_command");

    const act = toolsForAutonomy("act").map((tool) => tool.name);
    expect(act).toContain("write_file");
  });

  test("finish cannot claim a check that was never run", () => {
    const outcome = validateFinish(
      { summary: "done", checks: [{ command: "npm test", expect_exit_zero: true }] },
      [{ seq: 1, command: "npm run build", exit_code: 0 }]
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("was not run");
  });

  test("finish cannot claim a passing check that exited non-zero", () => {
    const outcome = validateFinish(
      { summary: "done", checks: [{ command: "npm run build" }] },
      [{ seq: 1, command: "npm run build", exit_code: 2 }]
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("exited 2");
  });

  test("finish accepts a claim backed by a recorded exit 0, across whitespace", () => {
    const outcome = validateFinish(
      {
        summary: "build is clean",
        checks: [{ command: "npm run   build", expect_exit_zero: true }],
      },
      [{ seq: 1, command: "npm run build", exit_code: 0 }]
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.checks[0].exitCode).toBe(0);
  });

  test("output is a marked tail, not a silent truncation", () => {
    const small = missionOutput("hello", 100);
    expect(small.truncated).toBe(false);

    const big = missionOutput("x".repeat(500), 100);
    expect(big.truncated).toBe(true);
    expect(big.text).toContain("truncated");
  });

  test("a command survives single quotes when wrapped for the shell", () => {
    expect(shellQuote("echo 'hi'")).toBe(`'echo '\\''hi'\\'''`);
  });
});

describe("mission description", () => {
  const base: MissionRow = {
    id: "00000000-0000-0000-0000-000000000000",
    owner: "00000000-0000-0000-0000-000000000001",
    chat_id: "00000000-0000-0000-0000-000000000003",
    model: "auto",
    status: "done",
    stage: "collect",
    goal: "build it",
    autonomy: "act",
    repo_full_name: "owner/repo",
    base_sha: "abc123",
    failure_code: null,
    failure_detail: null,
    sandbox_id: "sandbox",
    commands_count: 4,
    changed_files: 2,
    diff_bytes: 1200,
    reserved_dew: 1,
    charged_dew: 0.2,
    started_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
    last_tick_at: null,
    ended_at: new Date().toISOString(),
    heartbeat_at: null,
    result_changeset_id: "00000000-0000-0000-0000-000000000002",
  };

  test("done with a changeset names the file count and the command count", () => {
    const description = describeMission(base, 4);
    expect(description.state).toBe("succeeded");
    expect(description.detail).toContain("2 file(s)");
    expect(description.detail).toContain("4 command(s)");
  });

  test("done with no changes is not a success story", () => {
    const description = describeMission(
      { ...base, result_changeset_id: null, changed_files: 0 },
      3
    );

    expect(description.title).toBe("Nothing to change");
    expect(description.detail).not.toContain("passed");
  });

  test("done without a collected diff claims nothing", () => {
    const description = describeMission(
      { ...base, result_changeset_id: null, changed_files: null },
      3
    );

    expect(description.title).toBe("No result recorded");
  });

  test("a paused mission is paused, not running", () => {
    const description = describeMission({ ...base, status: "paused" }, 4);
    expect(description.state).toBe("paused");
  });

  test("no mission sentence ever claims tests passed", () => {
    const states: MissionRow["status"][] = [
      "queued",
      "running",
      "paused",
      "done",
      "failed",
      "timed_out",
      "cancelled",
      "stalled",
    ];

    for (const status of states) {
      const description = describeMission({ ...base, status }, 4);
      const text = `${description.title} ${description.detail}`.toLowerCase();
      expect(text).not.toContain("tests passed");
      expect(text).not.toContain("all tests");
    }
  });
});
