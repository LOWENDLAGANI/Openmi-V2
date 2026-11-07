/**
 * Which providers Auto is allowed to spend.
 *
 * Kept out of `lib/providers.ts` — which holds the API keys and needs
 * `server-only` — so the rule can be tested without the server guard, the same
 * way the queue planner is.
 *
 * Why it exists: Auto is a queue over "every model this deployment can call",
 * and a provider billed against the owner's own prepaid balance can be drained
 * by a message nobody aimed at it. Naming such a provider in the picker still
 * works; only the queue leaves it out.
 *
 * The set is empty right now. DeepSeek is the only built-in provider left, so
 * excluding it would leave Auto with no model at all and every Auto request
 * would end in "no model is available". The seam stays here so a future
 * prepaid provider can be excluded without touching the queue.
 */

import type { RouteProvider } from "../models/routes";

export const AUTO_EXCLUDED_PROVIDERS: ReadonlySet<RouteProvider> =
  new Set<RouteProvider>();

/** True when Auto may queue a model served by this provider. */
export function autoMaySpend(provider: RouteProvider): boolean {
  return !AUTO_EXCLUDED_PROVIDERS.has(provider);
}
