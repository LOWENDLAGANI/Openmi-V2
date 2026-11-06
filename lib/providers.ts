import "server-only";

import {
  DEFAULT_MODEL,
  MODELS,
  type ModelCapability,
  type ModelId,
} from "@/lib/models";
import { parseCustomModels, type CustomModel } from "@/lib/models/custom";
import { routeForModel } from "@/lib/models/routes";
import {
  EmptyCompletionError,
  MAX_COMPLETION_TOKENS,
  ProviderError,
  assertAnswer,
  readDelta,
  thinkingOption,
} from "@/lib/provider-stream";

/**
 * The vendor layer. Server only.
 *
 * Everything here — endpoints, model ids, key names — stays on the server. The
 * browser asks for a model id and never learns which vendor answered, because
 * that answer is not useful to a user and is useful to someone probing the
 * deployment.
 *
 * All three providers speak the OpenAI chat-completions shape, so one streaming
 * parser covers them and a fallback chain is a list rather than three code
 * paths.
 */

export type ProviderId = "openrouter" | "groq" | "deepseek";

export type Provider = {
  id: ProviderId;
  endpoint: string;
  model: string;
  keyName: "OPENROUTER_API_KEY" | "GROQ_API_KEY" | "DEEPSEEK_API_KEY";
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

const GROQ: Provider = {
  id: "groq",
  endpoint: "https://api.groq.com/openai/v1/chat/completions",
  // Groq is asked for one model only. Anything else it serves is ignored, so a
  // stray upstream id cannot become a second, unpriced path.
  model: "openai/gpt-oss-120b",
  keyName: "GROQ_API_KEY",
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
 * (`GROQ_API_KEYS`), then numbered variants (`GROQ_API_KEY_2`, `_3`). Duplicates
 * are dropped, so a pool that repeats the primary does not make the same key
 * fail twice.
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
  // "auto" is no longer a picker entry, but rows written before the catalogue
  // shrank still name it. It means "the default model", not a second routing
  // rule, so an old chat answers instead of failing.
  const id = model === "auto" ? DEFAULT_MODEL : model;

  const route = routeForModel(id, custom);
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

  const catalogue: ModelCapability[] = MODELS.map((model) => ({
    ...model,
    available: providersFor(model.id, env, custom).length > 0,
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
      available: providersFor(model.id, env, custom).length > 0,
    });
  }

  return catalogue;
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
  return [OPENROUTER, GROQ, DEEPSEEK];
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
}: {
  provider: Provider;
  apiKeys: string[];
  messages: ChatMessage[];
  signal: AbortSignal;
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
}: {
  provider: Provider;
  apiKey: string;
  messages: ChatMessage[];
  signal: AbortSignal;
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
      max_tokens: MAX_COMPLETION_TOKENS,
      ...thinkingOption(provider),
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
        if (frame.reasoning) sawReasoning = true;

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
  | { role: "system" | "user" | "assistant"; content: string; tool_calls?: WireToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type ChatEvent =
  | { type: "text"; text: string }
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
      messages,
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
      max_tokens: MAX_COMPLETION_TOKENS,
      ...thinkingOption(provider),
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
        if (frame.reasoning) sawReasoning = true;

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
