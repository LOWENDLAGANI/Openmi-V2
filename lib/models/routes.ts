/**
 * Where each named model is served from.
 *
 * This file is imported by lib/providers.ts and by tests only. It deliberately
 * holds the vendor, the upstream id and nothing that a client component needs,
 * so a display name can be public while the routing stays on the server.
 */

export type RouteProvider = "openrouter" | "deepseek";

export type ModelRoute = { provider: RouteProvider; upstream: string };

export const BUILTIN_ROUTES: Record<string, ModelRoute> = {
  // One model per vendor. Every other id those vendors serve is deliberately
  // absent: an unused route is an unpriced path nobody chose.
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
