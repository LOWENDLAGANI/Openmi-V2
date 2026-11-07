/**
 * Which providers Auto is allowed to spend.
 *
 * Kept out of `lib/providers.ts` — which holds the API keys and needs
 * `server-only` — so the rule can be tested without the server guard, the same
 * way the queue planner is.
 *
 * Why it exists: Auto is a queue over "every model this deployment can call",
 * and DeepSeek is billed against the owner's own prepaid balance rather than a
 * free tier. A message nobody aimed at DeepSeek therefore quietly drained that
 * balance. Naming DeepSeek in the picker still works; only the queue leaves it
 * out.
 */

import type { RouteProvider } from "../models/routes";

export const AUTO_EXCLUDED_PROVIDERS: ReadonlySet<RouteProvider> =
  new Set<RouteProvider>(["deepseek"]);

/** True when Auto may queue a model served by this provider. */
export function autoMaySpend(provider: RouteProvider): boolean {
  return !AUTO_EXCLUDED_PROVIDERS.has(provider);
}
