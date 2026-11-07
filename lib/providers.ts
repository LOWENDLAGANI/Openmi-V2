import "server-only";

import {
  AUTO_MODEL,
  MODELS,
  type ModelCapability,
  type ModelId,
} from "@/lib/models";
import { parseCustomModels, type CustomModel } from "@/lib/models/custom";
import { AUTO_ROUTES, routeForModel } from "@/lib/models/routes";
import { MAX_CHAIN_LENGTH, planChain } from "@/lib/routing/chain";
import { classifyTask } from "@/lib/routing/classify";
import { DEW_PER_HOUR } from "@/lib/dew";
import {
  EmptyCompletionError,
  ProviderError,
  assertAnswer,
  completionBudget,
  readDelta,
} from "@/lib/provider-stream";

/**
 * The vendor layer. Server only.
 *
 * Everything here — endpoints, model ids, key names — stays on the server. The
 * browser asks for a model id and never learns which vendor answered, because
 * that answer is not useful to a user and is useful to someone probing the
 * deployment.
 *
 * Both providers speak the OpenAI chat-completions shape, so one streaming
 * parser covers them and a fallback chain is a list rather than two code
 * paths.
 */

export type ProviderId = "openrouter" | "deepseek";

export type Provider = {
  id: ProviderId;
  endpoint: string;
  model: string;
  keyName: "OPENROUTER_API_KEY" | "DEEPSEEK_API_KEY";
  /**
   * The vendor reasons before it answers unless the request says otherwise.
   *
   * DeepSeek's thinking mode is on by default, and its chain of thought arrives
   * in `reasoning_content` — a different field from `content`. A parser that
   * reads only `content` therefore sees a thinking model produce nothing, which
   * is how a successful reply became "the provider returned an empty answer".
   */
  thinksByDefault?: boolean;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const OPENROUTER: Provider = {
  id: "openrouter",
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  model: "openai/gpt-4o-mini",
  keyName: "OPENROUTER_API_KEY",
};

const DEEPSEEK: Provider = {
  id: "deepseek",
  endpoint: "https://api.deepseek.com/chat/completions",
  // The only DeepSeek model this deployment offers. A named route may override
  // it, and the route table is where that decision lives.
  model: "deepseek-flash",
  keyName: "DEEPSEEK_API_KEY",
  thinksByDefault: true,
};

// Frame parsing and the reasoning toggle are pure, so they live in
// lib/provider-stream.ts where a test can import them without the server-only
// guard this file needs for API keys.

/** How many numbered variants one provider may hold. */
export const MAX_PROVIDER_KEYS = 3;

/**
 * Every usable key for one provider, in the order they should be tried.
 *
 * The primary name comes first, then a comma or space separated pool
 * (`<PROVIDER>_API_KEYS`), then numbered variants (`_2`, `_3`). Duplicates are
 * dropped, so a pool that repeats the primary does not make the same key fail
 * twice.
 */
export function providerKeys(
  provider: Provider,
  env: Record<string, string | undefined> = process.env
): string[] {
  const keys: string[] = [];

  const push = (value: string | undefined) => {
    const key = (value ?? "").trim();
    if (key.length > 0 && !keys.includes(key)) keys.push(key);
  };

  push(env[provider.keyName]);

  for (const part of (env[`${provider.keyName}S`] ?? "").split(/[,\s]+/)) {
    push(part);
  }

  for (let index = 2; index <= MAX_PROVIDER_KEYS; index += 1) {
    push(env[`${provider.keyName}_${index}`]);
  }

  return keys;
}

/** The first key, for single-value callers: probes and availability. */
export function providerKey(
  provider: Provider,
  env: Record<string, string | undefined> = process.env
): string {
  return providerKeys(provider, env)[0] ?? "";
}

export function providerById(id: ProviderId): Provider | undefined {
  return providerCatalogue().find((provider) => provider.id === id);
}

/**
 * The providers this deployment can actually call for a model, in order.
 *
 * `auto` keeps the preference chain. A named model resolves to exactly one
 * route with its own upstream id, and an empty list means "unknown model or no
 * key", which the caller reports plainly instead of guessing.
 */
export function providersFor(
  model: ModelId,
  env: Record<string, string | undefined> = process.env,
  custom: readonly CustomModel[] = parseCustomModels(env.CUSTOM_MODELS).models
): Provider[] {
  // Auto has no single route: it is the OpenRouter pool below. Missions and
  // verification ask for one model and iterate the result, so handing them the
  // whole queue lets them walk it the same way the chat turn does.
  if (model === AUTO_MODEL) return autoChain("", env);

  const route = routeForModel(model, custom);
  if (!route) return [];

  const provider = providerById(route.provider);
  if (!provider || providerKeys(provider, env).length === 0) return [];

  // One provider, with the upstream id this model names.
  return [{ ...provider, model: route.upstream }];
}

/**
 * What the picker shows: built-ins plus CUSTOM_MODELS, each marked with whether
 * a key exists for it. Availability is a server fact; the name is public.
 */
export function modelCatalogue(
  env: Record<string, string | undefined> = process.env
): ModelCapability[] {
  const custom = parseCustomModels(env.CUSTOM_MODELS).models;

  const callable = (id: ModelId) => providersFor(id, env, custom).length > 0;

  // Auto is its own pool: the OpenRouter free catalogue. It does not borrow a
  // concrete model's key and it does not fall back to DeepSeek, so its
  // availability is the OpenRouter key plus at least one route to spend it on.
  const autoReady = () => {
    const openrouter = providerById("openrouter");
    return (
      openrouter !== undefined &&
      providerKeys(openrouter, env).length > 0 &&
      Object.keys(AUTO_ROUTES).length > 0
    );
  };

  const catalogue: ModelCapability[] = MODELS.map((model) => ({
    ...model,
    available: model.id === AUTO_MODEL ? autoReady() : callable(model.id),
  }));

  for (const model of custom) {
    if (MODELS.some((builtin) => builtin.id === model.id)) continue;

    catalogue.push({
      id: model.id,
      name: model.name,
      category: model.category,
      blurb: model.blurb,
      images: false,
      documents: false,
      // A custom entry has no price of its own, so it costs the default hour.
      dewPerHour: DEW_PER_HOUR,
      available: providersFor(model.id, env, custom).length > 0,
    });
  }

  return catalogue;
}

/**
 * Auto's queue: every OpenRouter free route, best fit first.
 *
 * Auto is deliberately not a queue over the picker catalogue. The pool is the
 * OpenRouter catalogue in lib/models/routes.ts, so a deployment with only the
 * DeepSeek key cannot silently spend it through Auto. Once the OpenRouter key
 * exists the whole pool is callable, and the pipeline walks it until one model
 * answers.
 *
 * The message is classified once, then the queue is ordered by the registry's
 * fitness. Vendor, upstream id and key stay server-side; the reader is never
 * told which model answered, or that earlier ones failed.
 */
export function autoChain(
  prompt = "",
  env: Record<string, string | undefined> = process.env
): Provider[] {
  const openrouter = providerById("openrouter");
  if (!openrouter || providerKeys(openrouter, env).length === 0) return [];

  const available = Object.keys(AUTO_ROUTES);
  if (available.length === 0) return [];

  const queue = planChain({
    available,
    task: classifyTask(prompt),
    limit: MAX_CHAIN_LENGTH,
  });

  const targets: Provider[] = [];
  const seen = new Set<string>();

  for (const id of queue) {
    const route = AUTO_ROUTES[id];
    if (!route) continue;

    // Two ids can name the same upstream model; asking it twice would spend an
    // attempt on the same failure.
    const key = `${openrouter.id}:${route.upstream}`;
    if (seen.has(key)) continue;

    seen.add(key);
    targets.push({ ...openrouter, model: route.upstream });
  }

  return targets;
}

export function providersConfigured(
  env: Record<string, string | undefined> = process.env
): boolean {
  // Ready means a model the picker actually offers can be called, not that some
  // provider this build never routes to happens to have a key.
  return modelCatalogue(env).some((model) => model.available === true);
}

/** Every provider, for the setup page to probe each configured key. */
export function providerCatalogue(): Provider[] {
  return [OPENROUTER, DEEPSEEK];
}

/**
 * Streams text deltas from one provider.
 *
 * An abort signal is passed straight through to `fetch`, so a user pressing
 * Stop ends the upstream request rather than only hiding the output. That is
 * the difference between stopping and pretending to stop.
 */
/**
 * Streams text deltas from one provider, rotating its keys before the first
 * token.
 *
 * Keys for the same provider and model are tried in order. Once a delta has
 * reached the reader a second key is no longer attempted, because a retry would
 * replay the answer from the top; the caller sees one continuous answer or one
 * failure. A key that was rejected or rate limited simply hands over to the
 * next one, and nothing about the rotation reaches the browser.
 */
export async function* streamCompletion({
  provider,
  apiKeys,
  messages,
  signal,
  onReasoning,
}: {
  provider: Provider;
  apiKeys: string[];
  messages: ChatMessage[];
  signal: AbortSignal;
  /**
   * Where a thinking model's chain of thought goes.
   *
   * It is a callback rather than another yielded value because this generator's
   * contract is "answer text": a caller that only wants the answer keeps
   * working, and the transcript can still show what the model weighed.
   */
  onReasoning?: (text: string) => void;
}): AsyncGenerator<string> {
  const keys = apiKeys.map((key) => key.trim()).filter((key) => key.length > 0);

  if (keys.length === 0) {
    throw new ProviderError("No API key is configured for this provider.");
  }

  let lastError: unknown = null;

  for (const apiKey of keys) {
    let produced = false;

    try {
      for await (const delta of streamCompletionOnce({
        provider,
        apiKey,
        messages,
        signal,
        onReasoning,
      })) {
        produced = true;
        yield delta;
      }
      return;
    } catch (caught) {
      lastError = caught;
      // An empty completion would be empty on every key: retrying it spends a
      // second key on the same request the model already declined.
      if (produced || signal.aborted || caught instanceof EmptyCompletionError) {
        throw caught;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ProviderError("Every key for this provider failed.");
}

async function* streamCompletionOnce({
  provider,
  apiKey,
  messages,
  signal,
  onReasoning,
}: {
  provider: Provider;
  apiKey: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  onReasoning?: (text: string) => void;
}): AsyncGenerator<string> {
  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: true,
      temperature: 0.2,
      max_tokens: completionBudget(provider),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    // The body is not surfaced to the browser; it can contain the key prefix or
    // an upstream trace, and the UI only needs to know which kind of failure it
    // was.
    throw new ProviderError(
      response.status === 401 || response.status === 403
        ? "The provider rejected the server's key."
        : response.status === 429
          ? "The provider is rate limiting this deployment."
          : `The provider answered ${response.status}.`,
      response.status
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawAnswer = false;
  let sawReasoning = false;
  let finishReason: string | null = null;

  frames: while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload.length === 0) continue;
        if (payload === "[DONE]") break frames;

        const frame = readDelta(payload);
        if (!frame) continue;

        if (frame.finishReason) finishReason = frame.finishReason;

        if (frame.reasoning) {
          sawReasoning = true;
          // A thought is handed over as a thought, never as answer text: the two
          // are different claims about the same turn.
          onReasoning?.(frame.reasoning);
        }

        if (frame.content) {
          sawAnswer = true;
          yield frame.content;
        }
      }
    }
  }

  assertAnswer({ sawAnswer, sawReasoning, finishReason });
}

export type AgentToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type WireToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type WireMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
      tool_calls?: WireToolCall[];
      /**
       * The chain of thought that produced this turn, echoed back with it.
       *
       * DeepSeek answers 400 when a tool-calling assistant message drops the
       * reasoning it just sent, so a multi-step turn on a thinking model cannot
       * work without carrying it. `withoutReasoning` keeps it away from the
       * providers that never sent one.
       */
      reasoning_content?: string;
    }
  | { role: "tool"; content: string; tool_call_id: string };

/**
 * Drops reasoning from a history that a non-thinking provider will receive.
 *
 * The field exists because one vendor needs it echoed back; handing it to a
 * vendor that never heard of it risks a 400 on a field it does not validate.
 */
function withoutReasoning(messages: WireMessage[]): WireMessage[] {
  return messages.map((message) => {
    if (message.role === "tool" || !message.reasoning_content) return message;

    return {
      role: message.role,
      content: message.content,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    };
  });
}

export type ChatEvent =
  | { type: "text"; text: string }
  /** The model's chain of thought: something it said, not its answer. */
  | { type: "reasoning"; text: string }
  | {
      type: "tool";
      index: number;
      id?: string;
      name?: string;
      argumentsDelta?: string;
    };

/**
 * One streamed completion that can also ask for tools.
 *
 * Tool-call fragments arrive incrementally in the same stream as text, which is
 * why this yields events rather than strings: the caller needs to know which
 * kind of thing it just received, and a tool call is not prose.
 */
/**
 * The tool-calling stream, with the same key rotation rule as the text one.
 * A tool frame counts as output: once one has been read, restarting on another
 * key would re-send the whole turn.
 */
export async function* streamChat({
  provider,
  apiKeys,
  messages,
  tools,
  signal,
}: {
  provider: Provider;
  apiKeys: string[];
  messages: WireMessage[];
  tools: AgentToolDefinition[];
  signal: AbortSignal;
}): AsyncGenerator<ChatEvent> {
  const keys = apiKeys.map((key) => key.trim()).filter((key) => key.length > 0);

  if (keys.length === 0) {
    throw new ProviderError("No API key is configured for this provider.");
  }

  let lastError: unknown = null;

  for (const apiKey of keys) {
    let produced = false;

    try {
      for await (const event of streamChatOnce({
        provider,
        apiKey,
        messages,
        tools,
        signal,
      })) {
        produced = true;
        yield event;
      }
      return;
    } catch (caught) {
      lastError = caught;
      if (produced || signal.aborted || caught instanceof EmptyCompletionError) {
        throw caught;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ProviderError("Every key for this provider failed.");
}

async function* streamChatOnce({
  provider,
  apiKey,
  messages,
  tools,
  signal,
}: {
  provider: Provider;
  apiKey: string;
  messages: WireMessage[];
  tools: AgentToolDefinition[];
  signal: AbortSignal;
}): AsyncGenerator<ChatEvent> {
  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      // Only the reasoning model is sent its own reasoning back; the others are
      // handed a history they can validate.
      messages: provider.thinksByDefault ? messages : withoutReasoning(messages),
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: "auto",
      stream: true,
      temperature: 0.2,
      max_tokens: completionBudget(provider),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new ProviderError(
      response.status === 401 || response.status === 403
        ? "The provider rejected the server's key."
        : response.status === 429
          ? "The provider is rate limiting this deployment."
          : `The provider answered ${response.status}.`,
      response.status
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawAnswer = false;
  let sawReasoning = false;
  let finishReason: string | null = null;

  frames: while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload.length === 0) continue;
        if (payload === "[DONE]") break frames;

        const frame = readDelta(payload);
        if (!frame) continue;

        if (frame.finishReason) finishReason = frame.finishReason;

        if (frame.reasoning) {
          sawReasoning = true;
          yield { type: "reasoning", text: frame.reasoning };
        }

        if (frame.content) {
          sawAnswer = true;
          yield { type: "text", text: frame.content };
        }

        // A step that asked for a tool is a complete step even with no prose:
        // DeepSeek's own tool-call examples carry an empty `content`.
        for (const call of frame.toolCalls ?? []) {
          sawAnswer = true;
          yield {
            type: "tool",
            index: call.index,
            id: call.id,
            name: call.name,
            argumentsDelta: call.arguments,
          };
        }
      }
    }
  }

  assertAnswer({ sawAnswer, sawReasoning, finishReason });
}
