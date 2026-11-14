import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { refundDewSession } from "@/lib/dew/store";
import { refundReasonFor } from "@/lib/dew/refund";
import { readToken } from "@/lib/github/token";
import { AUTO_MODEL, type ModelId } from "@/lib/models";
import {
  autoChain,
  providerKeys,
  providersFor,
  streamChat,
  type WireMessage,
} from "@/lib/providers";
import type { SandboxHandle } from "@/lib/execution/provider";
import { serverEnv } from "@/lib/env";

import { collectRunArtifacts } from "./artifacts";
import { deliverChatTurn } from "./chat";
import {
  RUN_MAX_STEPS,
  RUN_MAX_TOKENS,
  RUN_STREAM_HEARTBEAT_MS,
  estimateTokens,
  runCostUsd,
  runWallClockMs,
} from "./limits";
import { capPayload, previewText } from "./redact";
import { openRunWorkspace, pauseRunWorkspace } from "./sandbox";
import {
  RUN_AGENT_ID,
  buildRunSystemPrompt,
  readProjectInstructions,
} from "./prompt";
import {
  appendEvent,
  appendRunMessage,
  appendToolCall,
  beginStep,
  cancelRequested,
  finishStep,
  heartbeat,
  listRunMessages,
  readRun,
  recordRunUsage,
  updateRun,
  type RunRow,
  type RunStatus,
} from "./store";
import {
  RUN_TOOL_SPECS,
  executeRunTool,
  listWorkspaceFiles,
  type RunToolResult,
} from "./tools";
import { toolSummary } from "./events";

/**
 * One run, from a claimed row to a settled one.
 *
 * This is the loop the plan describes and the reason the browser is only a
 * view: every model call, every tool call and every write happens here, in a
 * worker process with no public route. The browser opens an event stream and
 * watches the log these functions append to.
 *
 * The invariants, all enforced in code rather than in the prompt:
 *
 *   - a step is started with a compare-and-set before the model is called, so a
 *     cancelled or finished run can never spend another token;
 *   - cancellation is read at each step and tool boundary, and a tool in flight
 *     is always allowed to finish;
 *   - the sandbox is paused in a `finally`, whether the loop returned, threw or
 *     was stopped at a cap; it is destroyed 48 hours later by the sweep;
 *   - usage is recorded once, on the way out, from what the loop actually saw.
 */

export type ExecuteDeps = { admin: SupabaseClient };

type ToolCall = { id: string; name: string; args: string };

const MAX_DELTA_BUFFER = 160;
const DELTA_FLUSH_MS = 150;

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}

function parseArgs(raw: string): Record<string, unknown> | null {
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function summaryOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";
  return flat.length <= 500 ? flat : `${flat.slice(0, 497)}…`;
}

export async function executeRun(
  run: RunRow,
  deps: ExecuteDeps
): Promise<RunStatus> {
  const { admin } = deps;
  const runId = run.id;

  let sandbox: SandboxHandle | null = null;
  let status: RunStatus = "failed";
  let stopReason = "error";
  let failure: string | null = null;
  let summary = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let steps = run.steps;

  // What the chat gets back when this settles. `answerText` is the step that
  // ended without a tool call; `collectedText` is everything the model wrote,
  // which is what a cancelled or failed run has to show.
  let answerText = "";
  let collectedText = "";
  let changedFiles: string[] = [];
  let chatToken: string | null = null;

  const startedAt = Date.now();
  const deadline = startedAt + runWallClockMs();

  // A lease is refreshed while the loop runs so the reaper can tell a slow run
  // from a dead worker. A failed refresh means this worker lost the run, and
  // the next step's compare-and-set refuses it anyway.
  const lease = setInterval(() => {
    void heartbeat(admin, runId, run.worker_id ?? "");
  }, RUN_STREAM_HEARTBEAT_MS);

  try {
    await appendEvent(admin, runId, "run.started", {
      runId,
      model: run.model,
      agentId: RUN_AGENT_ID,
    });

    // The token is read in the worker, used once to fetch a tarball, and never
    // placed in the sandbox's environment or on a command line.
    const github =
      run.repo_full_name && run.base_sha
        ? await readToken(
            admin as unknown as Parameters<typeof readToken>[0],
            run.owner
          ).catch(() => null)
        : null;

    const opened = await openRunWorkspace({
      runId,
      repo: run.repo_full_name,
      sha: run.base_sha,
      token: github?.token ?? null,
    });

    if (!opened.ok) throw new Error(opened.message);

    sandbox = opened.sandbox;
    await updateRun(admin, runId, { sandbox_id: sandbox.id });

    // A chat turn arrives with the conversation behind it, already written to
    // run_messages by the route. A run started without history is seeded with
    // its prompt, so one loop serves both.
    const seeded = await listRunMessages(admin, runId);

    if (seeded.length === 0) {
      await appendRunMessage(admin, runId, "user", { text: run.prompt }, []);
    }

    const tree = await listWorkspaceFiles(sandbox);
    const instructions = await readProjectInstructions(sandbox);
    const system = buildRunSystemPrompt({
      repo: run.repo_full_name,
      sha: run.base_sha,
      tree,
      instructions,
    });

    const history: WireMessage[] =
      seeded.length > 0
        ? seeded.map((message) => ({ role: message.role, content: message.text }))
        : [{ role: "user", content: run.prompt }];

    const messages: WireMessage[] = [{ role: "system", content: system }, ...history];

    chatToken = github?.token ?? null;

    const chain =
      run.model === AUTO_MODEL
        ? autoChain(run.prompt)
        : providersFor(run.model as ModelId);

    if (chain.length === 0) {
      throw new Error(
        `No provider is configured for ${run.model}. The run cannot start.`
      );
    }

    let deltaBuffer = "";
    let lastFlush = 0;

    const flushDeltas = async (force = false) => {
      if (deltaBuffer.length === 0) return;
      if (!force && deltaBuffer.length < MAX_DELTA_BUFFER && Date.now() - lastFlush < DELTA_FLUSH_MS) {
        return;
      }

      const text = deltaBuffer;
      deltaBuffer = "";
      lastFlush = Date.now();
      await appendEvent(admin, runId, "message.delta", { text });
    };

    const emitUsage = async () => {
      await appendEvent(admin, runId, "usage", {
        inputTokens,
        outputTokens,
        costUsd: runCostUsd(inputTokens, outputTokens),
      });
    };

    let cancelled = false;

    loop: while (true) {
      if (await cancelRequested(admin, runId)) {
        cancelled = true;
        break;
      }

      if (steps >= RUN_MAX_STEPS) {
        status = "blocked";
        stopReason = "max-steps";
        await appendEvent(admin, runId, "warning", {
          code: "max-steps",
          message: `The run reached its ${RUN_MAX_STEPS}-step limit.`,
        });
        break;
      }

      if (inputTokens + outputTokens >= RUN_MAX_TOKENS) {
        status = "blocked";
        stopReason = "token-budget";
        await appendEvent(admin, runId, "warning", {
          code: "token-budget",
          message: `The run reached its ${RUN_MAX_TOKENS.toLocaleString()}-token estimate.`,
        });
        break;
      }

      if (Date.now() > deadline) {
        status = "blocked";
        stopReason = "wall-clock";
        await appendEvent(admin, runId, "warning", {
          code: "wall-clock",
          message: "The run reached its wall-clock limit.",
        });
        break;
      }

      const stepInput = estimateTokens(
        messages.map((message) => message.content).join("\n")
      );
      inputTokens += stepInput;

      const idx = await beginStep(admin, runId, {
        system: hashText(system),
        messages: hashText(messages.map((message) => `${message.role}:${message.content}`).join("\n")),
      });

      if (idx === null) {
        cancelled = true;
        break;
      }

      steps = idx;
      const stepStartedAt = Date.now();

      let stepText = "";
      let stepReasoning = "";
      const fragments = new Map<number, ToolCall>();
      let completed = false;
      let stepFailure: Error | null = null;

      for (const provider of chain) {
        try {
          for await (const event of streamChat({
            provider,
            apiKeys: providerKeys(provider),
            messages,
            tools: RUN_TOOL_SPECS,
            signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
          })) {
            if (event.type === "text") {
              stepText += event.text;
              deltaBuffer += event.text;
              outputTokens += estimateTokens(event.text);
              await flushDeltas();
            } else if (event.type === "reasoning") {
              // Recorded for the provider that requires it echoed back, never
              // streamed: the reader sees tool summaries, not chain-of-thought.
              stepReasoning += event.text;
            } else {
              const existing = fragments.get(event.index) ?? {
                id: "",
                name: "",
                args: "",
              };

              fragments.set(event.index, {
                id: event.id ?? existing.id,
                name: event.name ?? existing.name,
                args: existing.args + (event.argumentsDelta ?? ""),
              });
            }
          }

          completed = true;
          stepFailure = null;
          break;
        } catch (caught) {
          stepFailure = caught instanceof Error ? caught : new Error("The provider failed.");

          // Text or a half tool call means this step has already committed to
          // one answer; a handover would splice two of them together.
          if (stepText.length > 0 || fragments.size > 0) break;
        }
      }

      await flushDeltas(true);

      const calls = [...fragments.values()]
        .filter((call) => call.name.length > 0)
        .map((call, index) => ({
          id: call.id || `call_${index}`,
          name: call.name,
          args: call.args,
        }));

      if (!completed) {
        await finishStep(admin, runId, idx, {
          input_tokens: stepInput,
          output_tokens: estimateTokens(stepText),
          finish_reason: "error",
          tool_names: [],
          duration_ms: Date.now() - stepStartedAt,
        });

        if (await cancelRequested(admin, runId)) {
          cancelled = true;
          break;
        }

        failure = stepFailure?.message ?? "The provider failed.";
        status = "failed";
        stopReason = "error";
        break;
      }

      if (stepText.length > 0) {
        collectedText += `${collectedText.length > 0 ? "\n\n" : ""}${stepText}`;

        await appendRunMessage(
          admin,
          runId,
          "assistant",
          { text: stepText },
          calls.length > 0 ? ["step"] : ["answer"]
        );
      }

      if (calls.length === 0) {
        await finishStep(admin, runId, idx, {
          input_tokens: stepInput,
          output_tokens: estimateTokens(stepText),
          finish_reason: "stop",
          tool_names: [],
          duration_ms: Date.now() - stepStartedAt,
        });

        await appendEvent(admin, runId, "message.done", { step: idx });
        await emitUsage();

        answerText = stepText;
        summary = summaryOf(stepText);
        status = "done";
        stopReason = "answer";
        break;
      }

      messages.push({
        role: "assistant",
        content: stepText,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.args || "{}" },
        })),
        ...(stepReasoning.length > 0 ? { reasoning_content: stepReasoning } : {}),
      });

      const toolNames: string[] = [];

      for (const [index, call] of calls.entries()) {
        if (await cancelRequested(admin, runId)) {
          cancelled = true;
          break;
        }

        const args = parseArgs(call.args);
        toolNames.push(call.name);

        await appendEvent(admin, runId, "tool.started", {
          name: call.name,
          summary: toolSummary(call.name, args),
        });

        const toolStartedAt = Date.now();
        let result: RunToolResult;

        if (!sandbox) {
          result = {
            ok: false,
            isError: true,
            text: "The workspace is no longer available.",
            preview: "workspace missing",
          };
        } else {
          result = await executeRunTool({
            name: call.name,
            args,
            sandbox,
          }).catch((caught: unknown) => ({
            ok: false,
            isError: true,
            text: caught instanceof Error ? caught.message : "The tool failed.",
            preview: "tool failed",
          }));
        }

        const durationMs = Date.now() - toolStartedAt;

        await appendToolCall(admin, {
          runId,
          stepIdx: idx,
          idx: index + 1,
          name: call.name,
          args,
          result: capPayload(
            { ok: result.ok, isError: result.isError, text: result.text.slice(0, 32_000) },
            64_000
          ),
          isError: result.isError,
          durationMs,
        });

        await appendEvent(admin, runId, "tool.finished", {
          name: call.name,
          isError: result.isError,
          durationMs,
          resultPreview: previewText(result.text, 400),
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.text,
        });
      }

      await finishStep(admin, runId, idx, {
        input_tokens: stepInput,
        output_tokens: estimateTokens(stepText),
        finish_reason: cancelled ? "cancelled" : "tool_calls",
        tool_names: toolNames,
        duration_ms: Date.now() - stepStartedAt,
      });

      await emitUsage();

      if (cancelled) break loop;
    }

    if (cancelled) {
      status = "cancelled";
      stopReason = "cancelled";
    }

    // Artifacts are collected before the box is paused: the disk is still
    // there afterwards, but a run should not depend on a later process finding
    // it. A store that is not configured is not a failure.
    if (sandbox) {
      const collected = await collectRunArtifacts(sandbox, runId).catch(() => null);

      if (collected && collected.files.length > 0) {
        changedFiles = collected.files;
        summary = summary || `${collected.files.length} file(s) changed.`;
        await appendEvent(admin, runId, "usage", {
          inputTokens,
          outputTokens,
          costUsd: runCostUsd(inputTokens, outputTokens),
          filesChanged: collected.files.length,
          diffBytes: collected.diffBytes,
          diffKept: collected.diffKept,
        });
      }
    }
  } catch (caught) {
    failure = caught instanceof Error ? caught.message : "The run failed.";
    status = "failed";
    stopReason = "error";
  } finally {
    clearInterval(lease);

    // The chat is the product: the answer and its proposed diff are written
    // before the workspace is paused and before the run is marked settled, so a
    // reader who sees `run.finished` can already reload the transcript.
    if (run.chat_id) {
      const delivered = await deliverChatTurn({
        admin,
        run,
        sandbox,
        text: status === "done" ? answerText : collectedText,
        files: changedFiles,
        token: chatToken,
        sealKey: serverEnv().githubTokenKey,
        tokens: inputTokens + outputTokens,
      }).catch(() => ({ message: false, changeset: null }));

      if (!delivered.message) {
        console.error(`[runs] ${runId}: the chat answer was not written`);
      }
    }

    // The hour a chat turn paid for is refunded when the run failed with
    // nothing to show. A run that was stopped after text arrived stays charged,
    // for the same reason a stopped chat turn did: the reader got what they
    // asked for, then chose to end it.
    if (
      run.chat_id &&
      run.dew_session_id &&
      (status === "failed" || status === "cancelled")
    ) {
      const reason = refundReasonFor({
        textLength: collectedText.length,
        stopped: status === "failed" ? "error" : "aborted",
      });

      if (reason) {
        await refundDewSession(
          admin as never,
          run.owner,
          run.dew_session_id,
          reason
        ).catch(() => false);
      }
    }

    if (sandbox) await pauseRunWorkspace(sandbox);

    const cost = runCostUsd(inputTokens, outputTokens);

    await updateRun(
      admin,
      runId,
      {
        status,
        stop_reason: stopReason,
        error: failure,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: cost,
        ended_at: new Date().toISOString(),
      },
      { onlyWhileRunning: true }
    ).catch(() => {});

    await recordRunUsage(admin, run.owner, inputTokens, outputTokens, cost).catch(
      () => {}
    );

    if (status === "failed") {
      await appendEvent(admin, runId, "run.error", {
        code: "run-failed",
        message: failure ?? "The run failed.",
        retryable: true,
      });
    } else {
      await appendEvent(admin, runId, "run.finished", {
        stopReason,
        summary: summary || undefined,
        status,
      });
    }
  }

  return status;
}
