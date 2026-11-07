/**
 * Where each named model is served from.
 *
 * This file is imported by lib/providers.ts and by tests only. It deliberately
 * holds the vendor, the upstream id and nothing that a client component needs,
 * so a display name can be public while the routing stays on the server.
 */

export type RouteProvider = "openrouter" | "deepseek";

export type ModelRoute = { provider: RouteProvider; upstream: string };

/**
 * Auto's pool: the UnoRouter free catalogue.
 *
 * Auto has no endpoint of its own and no direct DeepSeek fallback. Every entry
 * here is a model Auto may try, ordered by the registry's fitness for the
 * request. The route id is the deployment's own slug — the `:free` suffix is a
 * price tag, not part of an id — while `upstream` is the exact string
 * UnoRouter is asked for.
 *
 * A model here that UnoRouter rejects costs one attempt, not the turn: the
 * pipeline walks the rest of the queue until one answers.
 */
export const AUTO_ROUTES: Record<string, ModelRoute> = {
  // Coding specialists.
  "qwen3-coder-plus": { provider: "openrouter", upstream: "qwen3-coder-plus:free" },
  "codestral-latest": { provider: "openrouter", upstream: "codestral-latest:free" },
  "qwen2.5-coder-32b": { provider: "openrouter", upstream: "qwen2.5-coder-32b:free" },
  "north-mini-code": { provider: "openrouter", upstream: "north-mini-code:free" },
  "swe-1-6-slow": { provider: "openrouter", upstream: "swe-1-6-slow:free" },

  // Agent, web search and computer use.
  "gpt-6-luna": { provider: "openrouter", upstream: "gpt-6-luna:free" },
  "gemini-3.6-flash": { provider: "openrouter", upstream: "gemini-3.6-flash:free" },
  "gemini-3.5-flash-lite": {
    provider: "openrouter",
    upstream: "gemini-3.5-flash-lite:free",
  },
  "gpt-4o": { provider: "openrouter", upstream: "gpt-4o:free" },

  // Reasoning and thinking specialists.
  "deepseek-v4.1-flash-1017": {
    provider: "openrouter",
    upstream: "deepseek-v4.1-flash-1017:free",
  },
  "minimax-m3.1-flash": { provider: "openrouter", upstream: "minimax-m3.1-flash:free" },
  "step-5-preview": { provider: "openrouter", upstream: "step-5-preview:free" },
  "glm-5.3-flash": { provider: "openrouter", upstream: "glm-5.3-flash:free" },
  "glm-5.3-flash-thinking": {
    provider: "openrouter",
    upstream: "glm-5.3-flash-thinking:free",
  },
  "glm-5.3-flash-search": {
    provider: "openrouter",
    upstream: "glm-5.3-flash-search:free",
  },
  "glm-5.3-flash-think-search": {
    provider: "openrouter",
    upstream: "glm-5.3-flash-think-search:free",
  },
  "nemotron-3-super-120b-a12b": {
    provider: "openrouter",
    upstream: "nemotron-3-super-120b-a12b:free",
  },
  beam: { provider: "openrouter", upstream: "beam:free" },
  "intern-s2": { provider: "openrouter", upstream: "intern-s2:free" },
  "intern-s2-preview-397b": {
    provider: "openrouter",
    upstream: "intern-s2-preview-397b:free",
  },
  "intern-s2-preview-35b": {
    provider: "openrouter",
    upstream: "intern-s2-preview-35b:free",
  },
  "intern-s1-pro": { provider: "openrouter", upstream: "intern-s1-pro:free" },
  "intern-s1": { provider: "openrouter", upstream: "intern-s1:free" },
  "intern-s1-mini": { provider: "openrouter", upstream: "intern-s1-mini:free" },
  "mistral-small": { provider: "openrouter", upstream: "mistral-small:free" },
  hy3: { provider: "openrouter", upstream: "hy3:free" },
  "laguna-xs-2.1": { provider: "openrouter", upstream: "laguna-xs-2.1:free" },

  // Open-weight, multimodal and general MoE fallbacks.
  "qwen3.8-27b": { provider: "openrouter", upstream: "qwen3.8-27b:free" },
  "qwen3.6-35b-a3b": { provider: "openrouter", upstream: "qwen3.6-35b-a3b:free" },
  "qwen3.6-27b": { provider: "openrouter", upstream: "qwen3.6-27b:free" },
  "qwen3.5-397b-a17b": { provider: "openrouter", upstream: "qwen3.5-397b-a17b:free" },
  "qwen3.5-9b": { provider: "openrouter", upstream: "qwen3.5-9b:free" },
  "qwen3.5-4b": { provider: "openrouter", upstream: "qwen3.5-4b:free" },
  qwen3: { provider: "openrouter", upstream: "qwen3:free" },
  "nemotron-3-ultra-550b-a55b": {
    provider: "openrouter",
    upstream: "nemotron-3-ultra-550b-a55b:free",
  },
  "nemotron-3.5-lightning-30b-a3b": {
    provider: "openrouter",
    upstream: "nemotron-3.5-lightning-30b-a3b:free",
  },
  "nemotron-3.5-super-vl": {
    provider: "openrouter",
    upstream: "nemotron-3.5-super-vl:free",
  },
  "mimo-v2.6-flash": { provider: "openrouter", upstream: "mimo-v2.6-flash:free" },
  "mistral-small-4-119b-2603": {
    provider: "openrouter",
    upstream: "mistral-small-4-119b-2603:free",
  },
  "mistral-small-3.2": { provider: "openrouter", upstream: "mistral-small-3.2:free" },
  "gpt-oss-120b": { provider: "openrouter", upstream: "gpt-oss-120b:free" },
  "gpt-oss-20b": { provider: "openrouter", upstream: "gpt-oss-20b:free" },
  "gpt-oss-safeguard-20b": {
    provider: "openrouter",
    upstream: "gpt-oss-safeguard-20b:free",
  },
  "glm-4.7-flash": { provider: "openrouter", upstream: "glm-4.7-flash:free" },
  "glm-4.6v-flash": { provider: "openrouter", upstream: "glm-4.6v-flash:free" },
  "glm-4.5-flash": { provider: "openrouter", upstream: "glm-4.5-flash:free" },
  "llama-4-scout": { provider: "openrouter", upstream: "llama-4-scout:free" },
  "cohere-command-a": { provider: "openrouter", upstream: "cohere-command-a:free" },
  "agnes-3.0-flash": { provider: "openrouter", upstream: "agnes-3.0-flash:free" },
  "agnes-2.5-flash": { provider: "openrouter", upstream: "agnes-2.5-flash:free" },
};

export const BUILTIN_ROUTES: Record<string, ModelRoute> = {
  ...AUTO_ROUTES,
  // The one named model served directly by its own vendor. It is deliberately
  // absent from AUTO_ROUTES: Auto never spends DeepSeek.
  "deepseek-flash": { provider: "deepseek", upstream: "deepseek-flash" },
};

export type CustomRouteInput = {
  id: string;
  provider: RouteProvider;
  upstream: string;
};

/**
 * A built-in id always wins over a custom entry with the same id, so a
 * deployment cannot silently redefine a model the UI already advertises.
 */
export function routeForModel(
  id: string,
  custom: readonly CustomRouteInput[] = []
): ModelRoute | null {
  const builtin = BUILTIN_ROUTES[id];
  if (builtin) return builtin;

  const match = custom.find((model) => model.id === id);
  return match ? { provider: match.provider, upstream: match.upstream } : null;
}
