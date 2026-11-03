import "server-only";

import {
  MODELS,
  type ModelCapability,
  type ModelId,
} from "@/lib/models";
import { parseCustomModels, type CustomModel } from "@/lib/models/custom";
import { routeForModel } from "@/lib/models/routes";

/**
 * The vendor layer. Server only.
 *
 * Everything here — endpoints, model ids, key names — stays on the server. The
 * browser asks for a capability id ("auto", "code", "flash") and never learns
 * which vendor answered, because that answer is not useful to a user and is
 * useful to someone probing the deployment.
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
  model: "llama-3.3-70b-versatile",
  keyName: "GROQ_API_KEY",
};

const DEEPSEEK: Provider = {
  id: "deepseek",
  endpoint: "https://api.deepseek.com/chat/completions",
  model: "deepseek-chat",
  keyName: "DEEPSEEK_API_KEY",
};

/** Ordered per capability: the first configured provider that succeeds wins. */
const CHAINS: Record<ModelId, Provider[]> = {
  auto: [OPENROUTER, GROQ, DEEPSEEK],
  code: [GROQ, OPENROUTER, DEEPSEEK],
  flash: [DEEPSEEK, GROQ, OPENROUTER],
};

export const MAX_COMPLETION_TOKENS = 2_000;

export class ProviderError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

export function providerKey(
  provider: Provider,
  env: Record<string, string | undefined> = process.env
): string {
  return (env[provider.keyName] ?? "").trim();
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
  if (model === "auto") {
    return CHAINS.auto.filter(
      (provider) => providerKey(provider, env).length > 0
    );
  }

  const route = routeForModel(model, custom);
  if (!route) return [];

  const provider = providerById(route.provider);
  if (!provider || providerKey(provider, env).length === 0) return [];

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
  return providersFor("auto", env).length > 0;
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
export async function* streamCompletion({
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

  while (true) {
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
        if (payload === "[DONE]") return;

        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) yield delta;
        } catch {
          // Keepalives and provider-specific frames are not answers. Skipping a
          // frame we cannot read is honest; inventing text from it is not.
        }
      }
    }
  }
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
export async function* streamChat({
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

  while (true) {
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
        if (payload === "[DONE]") return;

        let parsed: {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };

        try {
          parsed = JSON.parse(payload) as typeof parsed;
        } catch {
          continue;
        }

        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === "string" && delta.content.length > 0) {
          yield { type: "text", text: delta.content };
        }

        for (const call of delta.tool_calls ?? []) {
          yield {
            type: "tool",
            index: call.index ?? 0,
            id: call.id,
            name: call.function?.name,
            argumentsDelta: call.function?.arguments,
          };
        }
      }
    }
  }
}
