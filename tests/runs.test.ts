import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { putArtifact, readArtifact } from "../lib/runs/artifacts";

import {
  RUN_DAILY_RUNS,
  RUN_DAILY_TOKENS,
  RUN_MAX_STEPS,
  RUN_MAX_TOKENS,
  checkRunQuota,
  compactMessages,
  estimateTokens,
  runCostUsd,
  runMaxMinutes,
  workerConcurrency,
} from "../lib/runs/limits";
import {
  parseLastEventId,
  sseFrame,
  sseHeartbeat,
  sseOpen,
  toolSummary,
} from "../lib/runs/events";
import {
  capPayload,
  previewText,
  redactSecrets,
  tailBytes,
} from "../lib/runs/redact";
import { formatTree } from "../lib/runs/prompt";
import { internalTargetIn, safeRunPath } from "../lib/runs/tools";

/**
 * The rules the run runtime must keep, without a sandbox or a provider.
 *
 * The important assertions are negative: a second concurrent run is refused, a
 * path cannot leave the workspace, a command cannot name the metadata service,
 * and a token-shaped string never comes back out of a tool result.
 */

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

describe("run limits", () => {
  test("the documented caps are the ones the code enforces", () => {
    expect(RUN_MAX_STEPS).toBe(40);
    expect(RUN_MAX_TOKENS).toBe(120_000);
    expect(RUN_DAILY_RUNS).toBe(20);
    expect(RUN_DAILY_TOKENS).toBe(400_000);
  });

  test("a mis-set minute value cannot buy an hour", () => {
    expect(runMaxMinutes({})).toBe(15);
    expect(runMaxMinutes({ RUN_MAX_MINUTES: "99" })).toBe(30);
    expect(runMaxMinutes({ RUN_MAX_MINUTES: "0" })).toBe(15);
    expect(runMaxMinutes({ RUN_MAX_MINUTES: "nonsense" })).toBe(15);
    expect(runMaxMinutes({ RUN_MAX_MINUTES: "10" })).toBe(10);
  });

  test("worker concurrency is bounded", () => {
    expect(workerConcurrency({})).toBe(2);
    expect(workerConcurrency({ RUN_WORKER_CONCURRENCY: "99" })).toBe(8);
    expect(workerConcurrency({ RUN_WORKER_CONCURRENCY: "3" })).toBe(3);
  });

  test("cost is an estimate from tokens, rounded to column precision", () => {
    expect(runCostUsd(0, 0)).toBe(0);
    expect(runCostUsd(1_000_000, 0)).toBeCloseTo(0.15, 6);
    expect(runCostUsd(0, 1_000_000)).toBeCloseTo(0.6, 6);
    expect(runCostUsd(1_000, 1_000)).toBe(0.00075);
    // A negative count cannot become a credit.
    expect(runCostUsd(-10, -10)).toBe(0);
  });

  test("token estimates are characters over four", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("run quota", () => {
  test("a second concurrent run is refused first", () => {
    const decision = checkRunQuota({ active: 1, runsToday: 0, tokensToday: 0 });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe("concurrency");
  });

  test("the daily run budget is enforced", () => {
    const decision = checkRunQuota({
      active: 0,
      runsToday: RUN_DAILY_RUNS,
      tokensToday: 0,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe("daily-runs");
  });

  test("the daily token budget is enforced", () => {
    const decision = checkRunQuota({
      active: 0,
      runsToday: 1,
      tokensToday: RUN_DAILY_TOKENS,
    });

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe("daily-tokens");
  });

  test("inside every limit a run is allowed", () => {
    expect(checkRunQuota({ active: 0, runsToday: 5, tokensToday: 1_000 }).allowed).toBe(
      true
    );
  });
});

describe("run context", () => {
  const message = (role: string, text: string) => ({ role, content: text });

  test("compaction keeps the system prompt and the request, and drops the middle", () => {
    const messages = [
      message("system", "system"),
      message("user", "do the thing"),
      ...Array.from({ length: 20 }, (_, index) =>
        message(index % 2 === 0 ? "assistant" : "user", "x".repeat(1_000))
      ),
    ];

    const compacted = compactMessages(messages, 4_000);

    expect(compacted.evicted).toBeGreaterThan(0);
    expect(compacted.messages[0].content).toBe("system");
    expect(compacted.messages[1].content).toBe("do the thing");
    expect(compacted.chars).toBeLessThanOrEqual(4_000);
  });

  test("compaction never leaves a tool result without its assistant call", () => {
    const messages = [
      message("system", "system"),
      message("user", "go"),
      message("assistant", "calling"),
      message("tool", "y".repeat(2_000)),
      message("assistant", "more"),
      message("tool", "z".repeat(2_000)),
    ];

    const compacted = compactMessages(messages, 2_200);
    expect(compacted.messages[2]?.role).not.toBe("tool");
  });

  test("a tree is capped by paths and characters", () => {
    const tree = formatTree(Array.from({ length: 400 }, (_, index) => `file-${index}.ts`));

    expect(tree.split("\n").length).toBeLessThanOrEqual(200);
    expect(tree.length).toBeLessThanOrEqual(6_000);
    expect(formatTree([])).toBe("");
  });
});

describe("run events", () => {
  test("a frame is replayable: id, event, data", () => {
    const frame = sseFrame({
      seq: 7,
      kind: "message.delta",
      payload: { text: "hello\nworld" },
      at: "2026-01-01T00:00:00.000Z",
    });

    expect(frame).toContain("id: 7");
    expect(frame).toContain("event: message.delta");
    expect(frame).toContain('data: {"text":"hello\\nworld"}');
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  test("heartbeat and open frames are comments and hints", () => {
    expect(sseHeartbeat().startsWith(":")).toBe(true);
    expect(sseOpen()).toContain("retry:");
  });

  test("a cursor is parsed defensively", () => {
    expect(parseLastEventId("12")).toBe(12);
    expect(parseLastEventId("-4")).toBe(0);
    expect(parseLastEventId("nonsense")).toBe(0);
    expect(parseLastEventId(null)).toBe(0);
    expect(parseLastEventId("3.9")).toBe(3);
  });

  test("a tool summary describes the action, not the reasoning", () => {
    expect(toolSummary("edit_file", { path: "src/app/page.tsx" })).toBe(
      "editing src/app/page.tsx"
    );
    expect(toolSummary("read_file", { path: "README.md" })).toBe("reading README.md");
    expect(toolSummary("run_command", { command: "npm test" })).toBe("running npm test");
    expect(toolSummary("todo", {})).toBe("updating the plan");
  });

  test("the event payload is capped rather than unbounded", () => {
    const capped = capPayload({ text: "a".repeat(50_000) }, 1_000);

    expect(capped.truncated).toBe(true);
    expect(String(capped.text).length).toBeLessThan(50_000);
  });
});

describe("redaction", () => {
  test("token-shaped strings do not survive a tool result", () => {
    const input = [
      "OPENAI=sk-abcdefghijklmnopqrstuvwxyz123456",
      "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ].join("\n");

    const clean = redactSecrets(input);

    expect(clean).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(clean).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(clean).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(clean).toContain("[redacted");
  });

  test("a preview is one line", () => {
    expect(previewText("a\n\nb\tc", 100)).toBe("a b c");
    expect(previewText("x".repeat(20), 5).length).toBe(5);
  });

  test("a tail keeps the end, where the failure is", () => {
    const tail = tailBytes(`start\n${"z".repeat(200)}`, 50);
    expect(tail.truncated).toBe(true);
    expect(tail.text).toContain("truncated");
  });
});

describe("workspace safety", () => {
  test("a path cannot leave the workspace", () => {
    expect(safeRunPath("src/app/page.tsx")).toBe("src/app/page.tsx");
    expect(safeRunPath("./package.json")).toBe("package.json");
    expect(safeRunPath("../secrets")).toBeNull();
    expect(safeRunPath("/etc/passwd")).toBeNull();
    expect(safeRunPath("~/keys")).toBeNull();
    expect(safeRunPath("C:\\keys")).toBeNull();
    expect(safeRunPath("https://example.com")).toBeNull();
    expect(safeRunPath("")).toBeNull();
    expect(safeRunPath(42)).toBeNull();
  });

  test("a command naming an internal address is refused", () => {
    expect(internalTargetIn("curl http://169.254.169.254/latest/meta-data")).toBe(
      "cloud metadata address"
    );
    expect(internalTargetIn("curl http://10.0.0.5:8080")).toBe("private address");
    expect(internalTargetIn("curl http://127.0.0.1:3000")).toBe("loopback address");
    expect(internalTargetIn("curl http://192.168.1.1")).toBe("private address");
    expect(internalTargetIn("cat /proc/self/environ")).toBe("host network file");
    expect(internalTargetIn("npm install && npm run build")).toBeNull();
    expect(internalTargetIn("curl https://example.com")).toBeNull();
  });
});

describe("artifacts", () => {
  test("a stored artifact is content-addressed and readable again", async () => {
    process.env.RUN_ARTIFACT_DIR = mkdtempSync(join(tmpdir(), "openmi-runs-"));

    const stored = await putArtifact({
      runId: "11111111-1111-1111-1111-111111111111",
      path: "src/app/page.tsx",
      kind: "file",
      body: Buffer.from("export default 1;\n", "utf8"),
    });

    expect(stored.bytes).toBe(18);
    expect(stored.sha256).toHaveLength(64);
    expect(stored.storage_key).toContain("src/app/page.tsx");
    expect(await readArtifact(stored.storage_key)).toBe("export default 1;\n");
  });

  test("a key cannot escape the run's prefix", async () => {
    process.env.RUN_ARTIFACT_DIR = mkdtempSync(join(tmpdir(), "openmi-runs-"));

    const stored = await putArtifact({
      runId: "22222222-2222-2222-2222-222222222222",
      path: "../../etc/passwd",
      kind: "file",
      body: Buffer.from("no", "utf8"),
    });

    expect(stored.storage_key.startsWith("22222222-2222-2222-2222-222222222222/")).toBe(
      true
    );
    expect(stored.storage_key).not.toContain("..");
  });
});

describe("the runtime the plan requires exists in the repository", () => {
  test("runs are queue rows with an append-only event log", () => {
    const migration = read("/supabase/migrations/043_agent_runs.sql");

    expect(migration).toContain("create table if not exists public.runs");
    expect(migration).toContain("create table if not exists public.run_events");
    expect(migration).toContain("create table if not exists public.run_artifacts");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("alter table public.runs enable row level security");
    expect(migration).toContain("last_event_seq = last_event_seq + 1");
  });

  test("creation queues and answers 202 without running the loop", () => {
    const route = read("/app/api/runs/route.ts");

    expect(route).toContain("202");
    expect(route).toContain("checkRunQuota");
    expect(route).toContain("createRun");
    // The route must not call a provider or a sandbox.
    expect(route).not.toContain("streamChat");
    expect(route).not.toContain("createRunSandbox");
  });

  test("the stream replays from a cursor and says when it is alive", () => {
    const stream = read("/app/api/runs/[id]/stream/route.ts");

    expect(stream).toContain("last-event-id");
    expect(stream).toContain("sseFrame");
    expect(stream).toContain("sseHeartbeat");
    expect(stream).toContain("readEventsSince");
  });

  test("the worker is a separate entry point", () => {
    const entry = read("/worker/main.ts");
    const pkg = read("/package.json");

    expect(entry).toContain("runWorker");
    expect(pkg).toContain('"worker":');
    expect(pkg).toContain("--conditions=react-server");
  });
});
