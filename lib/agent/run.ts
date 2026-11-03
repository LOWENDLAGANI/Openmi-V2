import "server-only";

import type { ModelId } from "@/lib/models";
import {
  providerKeys,
  providersFor,
  streamChat,
  type WireMessage,
} from "@/lib/providers";

import { CONTINUE_AT_MS, MAX_STEPS, MAX_TURN_TOKENS } from "./envelope";
import {
  TOOL_SPECS,
  describeToolCall,
  parseArguments,
  runTool,
  type ToolContext,
} from "./tools";

export type AgentStepEvent = {
  type: "step";
  tool: string;
  detail: string;
  state: "start" | "done" | "error";
};

export type AgentResult = {
  text: string;
  steps: number;
  tokens: number;
  stopped: "done" | "steps" | "tokens" | "paused" | "aborted" | "error" | "conflict";
  notice?: string;
};

type RunOptions = {
  githubToken: string;
  repo: string;
  sha: string;
  paths: string[];
  model: ModelId;
  system: string;
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  steps: number;
  consume: (expectedSteps: number) => Promise<number | null>;
  emitText: (text: string) => void;
  emitStep: (event: AgentStepEvent) => void;
  propose?: ToolContext["propose"];
  signal: AbortSignal;
  startedAt: number;
};

/**
 * Runs one bounded turn.
 *
 * The loop is: ask, execute any requested reads, feed the results back, repeat.
 * Three things can stop it, and each one returns a different `stopped` value so
 * the caller can say which limit it hit instead of "something went wrong":
 * steps, tokens, and the wall clock a serverless function actually has.
 *
 * Every step is charged before the read happens, through a compare-and-set in
 * Postgres. A replay with an older step count is refused there, not here.
 */
export async function runAgent(options: RunOptions): Promise<AgentResult> {
  const messages: WireMessage[] = [
    { role: "system", content: options.system },
    ...options.history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const chain = providersFor(options.model);
  let steps = options.steps;

  // A named model resolves to one provider; without its key there is nothing
  // to call, and saying so beats an empty answer that blames the model.
  if (chain.length === 0) {
    return {
      text: "",
      steps,
      tokens: 0,
      stopped: "error",
      notice: "This model's provider key is not configured.",
    };
  }
  let tokens = 0;
  let text = "";

  while (true) {
    if (options.signal.aborted) {
      return { text, steps, tokens, stopped: "aborted" };
    }

    if (steps >= MAX_STEPS) {
      return {
        text,
        steps,
        tokens,
        stopped: "steps",
        notice: `This turn stopped at the ${MAX_STEPS}-step limit.`,
      };
    }

    if (tokens >= MAX_TURN_TOKENS) {
      return {
        text,
        steps,
        tokens,
        stopped: "tokens",
        notice: `This turn stopped at the ${MAX_TURN_TOKENS.toLocaleString()}-token budget.`,
      };
    }

    if (Date.now() - options.startedAt > CONTINUE_AT_MS) {
      return {
        text,
        steps,
        tokens,
        stopped: "paused",
        notice: "This turn reached its time limit and can be continued.",
      };
    }

    let providerText = "";
    const fragments = new Map<number, { id: string; name: string; args: string }>();
    let failure: Error | null = null;
    let completed = false;

    for (const provider of chain) {
      try {
        for await (const event of streamChat({
          provider,
          apiKeys: providerKeys(provider),
          messages,
          tools: TOOL_SPECS,
          signal: options.signal,
        })) {
          if (event.type === "text") {
            providerText += event.text;
            text += event.text;
            tokens += Math.max(1, Math.ceil(event.text.length / 4));
            options.emitText(event.text);
            if (tokens >= MAX_TURN_TOKENS) break;
          } else {
            const existing = fragments.get(event.index) ?? { id: "", name: "", args: "" };
            fragments.set(event.index, {
              id: event.id ?? existing.id,
              name: event.name ?? existing.name,
              args: existing.args + (event.argumentsDelta ?? ""),
            });
          }
        }
        completed = true;
        failure = null;
        break;
      } catch (caught) {
        failure = caught instanceof Error ? caught : new Error("The provider failed.");
        // Mid-answer failure is not retried with another provider: two
        // half-answers spliced together read as one confident wrong one.
        if (text.length > 0 || options.signal.aborted) break;
      }
    }

    if (!completed) {
      if (options.signal.aborted) return { text, steps, tokens, stopped: "aborted" };
      return {
        text,
        steps,
        tokens,
        stopped: "error",
        notice: failure?.message ?? "The provider failed.",
      };
    }

    if (fragments.size === 0) {
      return { text, steps, tokens, stopped: "done" };
    }

    const calls = [...fragments.values()].map((call, index) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      args: call.args,
    }));

    messages.push({
      role: "assistant",
      content: providerText,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.args || "{}" },
      })),
    });

    for (const call of calls) {
      const next = await options.consume(steps);
      if (next === null) {
        return {
          text,
          steps,
          tokens,
          stopped: "conflict",
          notice: "This turn can no longer advance: it was replayed, exhausted or expired.",
        };
      }
      steps = next;

      const args = parseArguments(call.args);
      const detail = describeToolCall(call.name, args ?? {});
      options.emitStep({ type: "step", tool: call.name, detail, state: "start" });

      const result = await runTool(call.name, args, {
        token: options.githubToken,
        fullName: options.repo,
        sha: options.sha,
        paths: options.paths,
        propose: options.propose,
      });

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.ok ? result.text : `error: ${result.error}`,
      });

      options.emitStep({
        type: "step",
        tool: call.name,
        detail,
        state: result.ok ? "done" : "error",
      });
    }
  }
}
