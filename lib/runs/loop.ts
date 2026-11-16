import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { approveChangesetAndOpenPullRequest } from "@/lib/changesets/commit";
import type { PublishDestination } from "@/lib/changesets/destination";
import { refundDewSession } from "@/lib/dew/store";
import { firstSignalIn, recordRiskSignal } from "@/lib/moderation/record";
import { refundReasonFor } from "@/lib/dew/refund";
import { autoWriteEnabled } from "@/lib/github/autowrite";
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
import type { AgentStep } from "@/lib/types";

import { collectRunArtifacts } from "./artifacts";
import { deliverChatTurn } from "./chat";
import {
  RUN_CANCEL_POLL_MS,
  RUN_MAX_STEPS,
  RUN_MAX_TOKENS,
  RUN_STREAM_HEARTBEAT_MS,
  compactMessages,
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
  resumeInstruction,
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
  listRunToolCalls,
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
  /** How this run gives its workspace back; set once the box is open. */
  let releaseWorkspace: (() => Promise<void>) | null = null;
  let status: RunStatus = "failed";
  let stopReason = "error";
  let failure: string | null = null;
  let summary = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let steps = run.steps;

  // What the chat gets back when this settles. `answerText` is the step that
  // ended without a tool call; `collectedText` is everything the model wrote,
  // which is what a cancelled or failed run has to show. `reasoningText` is the
  // chain of thought behind it, kept so a reloaded answer still has its fold.
  let answerText = "";
  let collectedText = "";
  let reasoningText = "";
  // The console the answer is stored with. The live tab reads the same work
  // from `run_events`; without this copy the steps vanished the moment the
  // transcript was reloaded, so a stored answer looked like it had done nothing.
  const stepLog: AgentStep[] = [];
  let changedFiles: string[] = [];
  let chatToken: string | null = null;

  // Where the reader asked this change to go, as the model declared it with
  // `publish`. Null means the reader did not say, which keeps the ordinary
  // destination: a derived agent branch, one pull request, merged.
  let publishDestination: PublishDestination | null = null;

  const startedAt = Date.now();
  const deadline = startedAt + runWallClockMs();

  // A lease is refreshed while the loop runs so the reaper can tell a slow run
  // from a dead worker. A failed refresh means this worker lost the run, and
  // the next step's compare-and-set refuses it anyway.
  const lease = setInterval(() => {
    void heartbeat(admin, runId, run.worker_id ?? "");
  }, RUN_STREAM_HEARTBEAT_MS);

  // The stop button writes a row, not a signal: the run is here and the reader
  // is in another process. Reading that row only between steps meant a stop
  // waited for the model to stop writing — and a stream that had gone quiet
  // never did, so the button appeared to do nothing for the rest of the run.
  // This watcher is what turns the row into an abort of the call in flight.
  const cancelWatch = new AbortController();
  const cancelPoll = setInterval(() => {
    if (cancelWatch.signal.aborted) return;
    void cancelRequested(admin, runId)
      .then((requested) => {
        if (requested) cancelWatch.abort();
      })
      .catch(() => {});
  }, RUN_CANCEL_POLL_MS);

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

    // A run handed back to the queue after its worker vanished is a second
    // attempt at the same request, not a new one: the workspace it left is
    // reattached and the transcript it wrote is continued rather than replayed.
    const resumed = run.retry_count > 0 || run.steps > 0;

    const opened = await openRunWorkspace({
      runId,
      admin,
      owner: run.owner,
      chatId: run.chat_id,
      repo: run.repo_full_name,
      sha: run.base_sha,
      token: github?.token ?? null,
      // The box a previous attempt recorded, so its edits survive the restart.
      sandboxId: run.sandbox_id,
      sandboxAccount: run.sandbox_account,
    });

    if (!opened.ok) throw new Error(opened.message);

    sandbox = opened.sandbox;
    releaseWorkspace = opened.release;

    // A chat's workspace belongs to its `chat_sandboxes` row, not to this run.
    // The run sweep lists only `kind: "run"` boxes and the chat sweep reads the
    // row, so recording the id here would claim a disk the next message is
    // supposed to find.
    if (!opened.shared) {
      await updateRun(admin, runId, {
        sandbox_id: sandbox.id,
        sandbox_account: sandbox.accountId,
      });
    }

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
      today: new Date().toISOString().slice(0, 10),
    });

    const history: WireMessage[] =
      seeded.length > 0
        ? seeded.map((message) => ({ role: message.role, content: message.text }))
        : [{ role: "user", content: run.prompt }];

    let messages: WireMessage[] = [{ role: "system", content: system }, ...history];

    // What a resumed run cannot see is the tool output it had read: the messages
    // were kept, the results were not. Telling it where it stopped, and what it
    // last ran, is what keeps the second attempt from starting over.
    if (resumed) {
      const recent = (await listRunToolCalls(admin, runId).catch(() => [])).slice(-8);

      messages = [
        ...messages,
        {
          role: "user",
          content: resumeInstruction({
            steps: run.steps,
            recent: recent.map((call) => ({
              name: call.name,
              detail: toolSummary(call.name, call.argsJson),
              failed: call.isError,
            })),
          }),
        },
      ];

      await appendEvent(admin, runId, "run.warning", {
        code: "run-resumed",
        message: `Resumed after a restart at step ${run.steps}, on the workspace the first attempt left.`,
      });
    }

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
    let reasoningBuffer = "";
    let lastFlush = 0;

    const flushDeltas = async (force = false) => {
      if (deltaBuffer.length === 0 && reasoningBuffer.length === 0) return;
      if (
        !force &&
        deltaBuffer.length < MAX_DELTA_BUFFER &&
        reasoningBuffer.length < MAX_DELTA_BUFFER &&
        Date.now() - lastFlush < DELTA_FLUSH_MS
      ) {
        return;
      }

      lastFlush = Date.now();

      // Reasoning rides its own channel. The transcript folds it away behind
      // one tap, so the reader who wants it can open it and the reader who does
      // not never sees it in the answer.
      if (reasoningBuffer.length > 0) {
        const thinking = reasoningBuffer;
        reasoningBuffer = "";
        await appendEvent(admin, runId, "message.reasoning", { text: thinking });
      }

      if (deltaBuffer.length === 0) return;

      const text = deltaBuffer;
      deltaBuffer = "";
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

      // Every step re-sends the context, so the oldest exchanges go before the
      // call once the prompt is larger than the run wants to carry. Without
      // this the prompt grew until the provider refused it — and the run's own
      // token budget was spent re-reading read output it had already paid for.
      // The system prompt and the request stay, and the eviction is reported so
      // a compacted turn is never mistaken for one that saw everything.
      const compacted = compactMessages(messages);
      if (compacted.evicted > 0) {
        messages = compacted.messages;
        await appendEvent(admin, runId, "warning", {
          code: "context-compacted",
          message: `Dropped ${compacted.evicted} older messages so the context fits the run's window.`,
        });
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
      // Why the provider stopped writing. `"length"` means the reply hit the
      // token budget mid-sentence, which is not the model finishing its answer.
      let stepFinish: string | null = null;

      // One signal per step, ended by the run's deadline or by the reader's
      // stop, whichever comes first. A stop therefore lands inside the answer
      // rather than after it.
      const stepStop = new AbortController();
      const stepDeadline = setTimeout(
        () => stepStop.abort(),
        Math.max(1_000, deadline - Date.now())
      );
      const onStop = () => stepStop.abort();
      cancelWatch.signal.addEventListener("abort", onStop, { once: true });
      if (cancelWatch.signal.aborted) stepStop.abort();

      for (const provider of chain) {
        try {
          for await (const event of streamChat({
            provider,
            apiKeys: providerKeys(provider),
            messages,
            tools: RUN_TOOL_SPECS,
            signal: stepStop.signal,
          })) {
            if (event.type === "text") {
              stepText += event.text;
              deltaBuffer += event.text;
              outputTokens += estimateTokens(event.text);
              await flushDeltas();
            } else if (event.type === "reasoning") {
              // Kept for the provider that requires it echoed back, and sent on
              // its own channel so the transcript can fold it away instead of
              // printing it as the answer.
              stepReasoning += event.text;
              reasoningText += event.text;
              reasoningBuffer += event.text;
              await flushDeltas();
            } else if (event.type === "finish") {
              stepFinish = event.reason;
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
          // A call aborted by the reader's stop is not the provider failing: the
          // `!completed` path below settles the step as cancelled.
          if (cancelWatch.signal.aborted) break;

          stepFailure = caught instanceof Error ? caught : new Error("The provider failed.");

          // Text or a half tool call means this step has already committed to
          // one answer; a handover would splice two of them together.
          if (stepText.length > 0 || fragments.size > 0) break;
        }
      }

      clearTimeout(stepDeadline);
      cancelWatch.signal.removeEventListener("abort", onStop);

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

      // A reply cut off at the reply budget is not an answer that ended: the
      // model was still writing when it ran out of room, so the turn used to
      // stop mid-sentence and look finished. Ask it to carry on from the seam
      // instead, and only settle the run when it says something complete. The
      // loop's own step and token caps bound how long that continuation can go.
      const truncated = stepFinish === "length" && stepText.trim().length > 0;

      if (
        truncated &&
        calls.length === 0 &&
        Date.now() < deadline &&
        steps < RUN_MAX_STEPS &&
        inputTokens + outputTokens < RUN_MAX_TOKENS
      ) {
        await finishStep(admin, runId, idx, {
          input_tokens: stepInput,
          output_tokens: estimateTokens(stepText),
          finish_reason: "length",
          tool_names: [],
          duration_ms: Date.now() - stepStartedAt,
        });

        await appendEvent(admin, runId, "warning", {
          code: "reply-limit",
          message: "The answer reached the reply limit, so it is continuing.",
        });

        messages.push({ role: "assistant", content: stepText });
        messages.push({
          role: "user",
          content:
            "Your last reply was cut off by the reply length limit. Continue from exactly where it stopped, without repeating what you already wrote.",
        });

        continue loop;
      }

      if (calls.length === 0) {
        await finishStep(admin, runId, idx, {
          input_tokens: stepInput,
          output_tokens: estimateTokens(stepText),
          finish_reason: stepFinish ?? "stop",
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
        const detail = toolSummary(call.name, args);
        toolNames.push(call.name);

        stepLog.push({ tool: call.name, detail, state: "start" });

        await appendEvent(admin, runId, "tool.started", {
          name: call.name,
          summary: detail,
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
            // A command in flight is killed rather than waited out: the stop
            // used to arrive only after the tool's own timeout.
            signal: cancelWatch.signal,
            github:
              github && run.repo_full_name
                ? { token: github.token, repo: run.repo_full_name }
                : null,
          }).catch((caught: unknown) => ({
            ok: false,
            isError: true,
            text: caught instanceof Error ? caught.message : "The tool failed.",
            preview: "tool failed",
          }));
        }

        const durationMs = Date.now() - toolStartedAt;

        if (result.publish) publishDestination = result.publish;

        // An attempt to reach loopback, a private range or the metadata service
        // is the one tool failure that is about intent rather than a bad
        // command. One signal per run: the operator needs to know it happened,
        // not how many times the model retried.
        if (
          result.text.startsWith("refused:") &&
          firstSignalIn(`egress:${runId}`, 6 * 3_600_000)
        ) {
          void recordRiskSignal({
            userId: run.owner,
            kind: "sandbox-egress",
            severity: "high",
            summary:
              "A sandbox command named an internal address and was refused",
            detail: {
              runId,
              tool: call.name,
              command:
                typeof args?.command === "string"
                  ? args.command.slice(0, 200)
                  : null,
            },
            route: "worker:run_command",
          });
        }

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

        const preview = previewText(result.text, 400);

        await appendEvent(admin, runId, "tool.finished", {
          name: call.name,
          isError: result.isError,
          durationMs,
          resultPreview: preview,
        });

        const finishedStep: AgentStep = {
          tool: call.name,
          detail,
          state: result.isError ? "error" : "done",
          output: preview,
        };

        let startedAt = -1;
        for (let index = stepLog.length - 1; index >= 0; index -= 1) {
          if (stepLog[index].state === "start" && stepLog[index].tool === call.name) {
            startedAt = index;
            break;
          }
        }

        if (startedAt >= 0) stepLog[startedAt] = finishedStep;
        else stepLog.push(finishedStep);

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.text,
        });
      }

      // A stop that killed a command ends the step here rather than at the top
      // of the next one, so a cancelled run settles at the tool it was in.
      if (cancelWatch.signal.aborted) cancelled = true;

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
    clearInterval(cancelPoll);

    // The chat is the product: the answer and its proposed diff are written
    // before the workspace is paused and before the run is marked settled, so a
    // reader who sees `run.finished` can already reload the transcript.
    if (run.chat_id) {
      const delivered = await deliverChatTurn({
        admin,
        run,
        sandbox,
        // Everything the model wrote is the answer, not only the last stretch
        // it wrote. A turn that narrated, ran a tool and carried on is one
        // answer, and storing just its tail is what made a reloaded transcript
        // look like the reply had been cut off halfway.
        text: collectedText.length > 0 ? collectedText : answerText,
        steps: stepLog,
        files: changedFiles,
        token: chatToken,
        sealKey: serverEnv().githubTokenKey,
        // Without this the stored answer had no `thinking` column and the fold
        // vanished on the first reload.
        thinking: reasoningText,
        tokens: inputTokens + outputTokens,
      }).catch((caught: unknown) => ({
        message: false,
        changeset: null,
        reason: `the chat delivery failed: ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      }));

      if (!delivered.message) {
        console.error(`[runs] ${runId}: the chat answer was not written`);
      }

      // A change that was recorded and never written is the one outcome the
      // reader cannot infer: the model says where it went, the app says nothing.
      // A plain answer that changed no files is not this case, so it stays quiet.
      if (
        !delivered.changeset &&
        status === "done" &&
        autoWriteEnabled() &&
        (changedFiles.length > 0 || publishDestination !== null)
      ) {
        await appendEvent(admin, runId, "warning", {
          code: "auto-write",
          message: `The change was not written: ${
            changedFiles.length === 0
              ? "this turn changed no files in the workspace, so there was no diff to write"
              : (delivered.reason ?? "the diff could not be recorded")
          }`,
        });
      }

      // The turn is the request. A ready change is written from here rather than
      // from a click on the card, because the signed changeset is already the
      // reviewed thing: one branch, one commit, never forced, and a re-apply
      // instead of a second PR. Where it lands is the model's read of the
      // reader's sentence (`publish`); a failed write is a sentence in the
      // transcript, not a dialog nobody opened.
      if (delivered.changeset && status === "done" && autoWriteEnabled()) {
        const applied = await approveChangesetAndOpenPullRequest(admin, {
          changesetId: delivered.changeset,
          owner: run.owner,
          sealKey: serverEnv().githubTokenKey,
          destination: publishDestination,
          // The model's `publish` call decides; this is only what the reader
          // wrote, read when the model left the destination out.
          requested: run.prompt,
        }).catch((caught: unknown) => ({
          ok: false as const,
          error:
            caught instanceof Error ? caught.message : "The change was not written.",
        }));

        if (applied.ok) {
          await appendEvent(admin, runId, "changeset.applied", {
            branch: applied.branch,
            prUrl: applied.prUrl,
            prNumber: applied.prNumber,
            mergeCommitSha: applied.mergeCommitSha,
            summary: applied.mergeCommitSha
              ? `Wrote ${applied.branch} and merged pull request #${applied.prNumber}.`
              : applied.prUrl
                ? `Wrote ${applied.branch} and opened pull request #${applied.prNumber}, unmerged.`
                : `Wrote ${applied.branch}.`,
          });
        } else {
          await appendEvent(admin, runId, "warning", {
            code: "auto-write",
            message: `The change was not written: ${applied.error}`,
          });
        }
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

    // A chat's workspace is released so the next message finds it; a run's own
    // box is paused, which releases compute and keeps the disk for its TTL.
    if (releaseWorkspace) await releaseWorkspace().catch(() => {});
    else if (sandbox) await pauseRunWorkspace(sandbox);

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
