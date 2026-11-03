/**
 * Where each named model is served from.
 *
 * This file is imported by lib/providers.ts and by tests only. It deliberately
 * holds the vendor, the upstream id and nothing that a client component needs,
 * so a display name can be public while the routing stays on the server.
 */

export type RouteProvider = "openrouter" | "groq" | "deepseek";

export type ModelRoute = { provider: RouteProvider; upstream: string };

export const BUILTIN_ROUTES: Record<string, ModelRoute> = {
  "gpt-oss-120b": { provider: "groq", upstream: "openai/gpt-oss-120b" },
  "glm-4.6": { provider: "openrouter", upstream: "z-ai/glm-4.6" },
  "qwen3-coder": { provider: "openrouter", upstream: "qwen/qwen3-coder" },
  "kimi-k2": { provider: "openrouter", upstream: "moonshotai/kimi-k2" },
  "deepseek-chat": { provider: "deepseek", upstream: "deepseek-chat" },
  "deepseek-reasoner": { provider: "deepseek", upstream: "deepseek-reasoner" },
  "llama-3.3-70b": { provider: "groq", upstream: "llama-3.3-70b-versatile" },
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
