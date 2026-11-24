import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SandboxHandle } from "../lib/execution/provider";
import { killRun } from "../lib/runs/store";
import { executeRunTool } from "../lib/runs/tools";

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

describe("true task kill and cancellation", () => {
  test("executeRunTool stops immediately on an aborted signal and passes signal to sandbox.exec", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;

    const sandbox = {
      exec: async (
        _cmd: string,
        _cwd?: string,
        _timeoutMs?: number,
        signal?: AbortSignal
      ) => {
        seenSignal = signal;
        return {
          command: "echo hi",
          exitCode: 0,
          output: "hi",
          truncated: false,
          durationMs: 5,
          timedOut: false,
        };
      },
    } as unknown as SandboxHandle;

    const okResult = await executeRunTool({
      name: "run_command",
      args: { command: "echo hi", purpose: "test" },
      sandbox,
      signal: controller.signal,
    });

    expect(okResult.ok).toBe(true);
    expect(seenSignal).toBe(controller.signal);

    controller.abort();

    const abortedResult = await executeRunTool({
      name: "run_command",
      args: { command: "sleep 60", purpose: "hang" },
      sandbox,
      signal: controller.signal,
    });

    expect(abortedResult.isError).toBe(true);
    expect(abortedResult.text).toContain("Cancelled");
  });

  test("killRun settles cleanly when the worker acknowledges cancel within grace window", async () => {
    const baseRow = {
      id: "run-1",
      owner: "user-1",
      chat_id: "chat-1",
      repo_full_name: null,
      base_sha: null,
      prompt: "test",
      model: "auto",
      effort: null,
      status: "running",
      stop_reason: null,
      error: null,
      sandbox_id: null,
      worker_id: "w-1",
      steps: 1,
      input_tokens: 10,
      output_tokens: 0,
      cost_usd: 0,
      cancel_requested: false,
      credit_session_id: "sess-1",
      last_event_seq: 1,
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      ended_at: null,
    };

    let readCount = 0;
    const rpcCalls: string[] = [];

    const fakeAdmin = {
      rpc: async (name: string) => {
        rpcCalls.push(name);
        return { data: true, error: null };
      },
      from: (table: string) => {
        if (table === "runs") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  readCount += 1;
                  if (readCount >= 2) {
                    return {
                      data: {
                        ...baseRow,
                        cancel_requested: true,
                        status: "cancelled",
                        stop_reason: "user",
                        ended_at: new Date().toISOString(),
                      },
                      error: null,
                    };
                  }
                  return { data: baseRow, error: null };
                },
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;

    const res = await killRun(fakeAdmin, "run-1", "user-1", {
      graceMs: 300,
      pollMs: 25,
    });

    expect(rpcCalls).toEqual(["request_run_cancel"]);
    expect(res.cancelled).toBe(true);
    expect(res.forced).toBe(false);
    expect(res.status).toBe("cancelled");
  });

  test("killRun force-cancels stuck running runs, clears sandbox lease, emits run.finished, and refunds empty runs", async () => {
    const runningRow = {
      id: "run-2",
      owner: "user-2",
      chat_id: "chat-2",
      repo_full_name: null,
      base_sha: null,
      prompt: "test",
      model: "auto",
      effort: null,
      status: "running",
      stop_reason: null,
      error: null,
      sandbox_id: null,
      worker_id: "w-1",
      steps: 1,
      input_tokens: 10,
      output_tokens: 0,
      cost_usd: 0,
      cancel_requested: false,
      credit_session_id: "sess-2",
      last_event_seq: 1,
      created_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      ended_at: null,
    };

    const cancelledRow = {
      ...runningRow,
      cancel_requested: true,
      status: "cancelled",
      stop_reason: "user",
      ended_at: new Date().toISOString(),
    };

    const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
    let leaseCleared = false;
    let forcedUpdate = false;

    const fakeAdmin = {
      rpc: async (name: string, params: Record<string, unknown>) => {
        rpcCalls.push({ name, params });
        if (name === "append_run_event") return { data: 2, error: null };
        return { data: true, error: null };
      },
      from: (table: string) => {
        if (table === "runs") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: runningRow, error: null }),
              }),
            }),
            update: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    select: () => ({
                      maybeSingle: async () => {
                        forcedUpdate = true;
                        return { data: cancelledRow, error: null };
                      },
                    }),
                  }),
                }),
              }),
            }),
          };
        }

        if (table === "chat_sandboxes") {
          return {
            update: () => ({
              eq: () => ({
                eq: async () => {
                  leaseCleared = true;
                  return { error: null };
                },
              }),
            }),
          };
        }

        if (table === "run_events") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
          };
        }

        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;

    const res = await killRun(fakeAdmin, "run-2", "user-2", {
      graceMs: 60,
      pollMs: 25,
    });

    expect(forcedUpdate).toBe(true);
    expect(leaseCleared).toBe(true);
    expect(res).toMatchObject({
      cancelled: true,
      forced: true,
      status: "cancelled",
    });
    expect(rpcCalls.map((call) => call.name)).toEqual([
      "request_run_cancel",
      "append_run_event",
      "try_refund_hour_session",
    ]);
    expect(rpcCalls[1]?.params.p_kind).toBe("run.finished");
    expect(rpcCalls[1]?.params.p_payload).toEqual({
      stopReason: "user",
      status: "cancelled",
      forced: true,
    });
  });

  test("worker loop, sandbox provider, stop routes, and ChatPanel enforce immediate kill and recovery", () => {
    const loop = read("/lib/runs/loop.ts");
    const provider = read("/lib/execution/provider.ts");
    const stopRoute = read("/app/api/chat/stop/route.ts");
    const cancelRoute = read("/app/api/runs/[id]/cancel/route.ts");
    const panel = read("/components/ChatPanel.tsx");

    expect(loop).toContain("RUN_CANCEL_POLL_MS");
    expect(loop).toContain("runSignal");
    expect(loop).toContain("if (runSignal.aborted) break;");
    expect(loop).toContain("signal: runSignal");
    expect(loop).toContain("!cancelled && !deps.stopSignal?.aborted");
    expect(loop).toContain("externallySettled");

    expect(provider).toContain("background: true");
    expect(provider).toContain("handle.kill()");

    expect(stopRoute).toContain("findActiveRunForOwner");
    expect(stopRoute).toContain("killRun");
    expect(cancelRoute).toContain("killRun");

    expect(panel).toContain("activeRunConflict");
    expect(panel).toContain("stopActiveRunAndRetry");
    expect(panel).toContain("all: true");
  });
});
