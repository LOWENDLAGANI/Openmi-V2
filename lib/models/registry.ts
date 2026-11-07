/**
 * The capability pool behind Auto.
 *
 * Auto is a model in the picker with no single endpoint. When a chat picks it,
 * this registry decides which model should answer and in what order the others
 * stand behind it. Nothing here is a route: no endpoint, no upstream id, no key.
 * Those stay in lib/models/routes.ts and lib/providers.ts.
 *
 * The ids are the deployment's own model ids, the same slugs CUSTOM_MODELS uses.
 * A vendor listing often writes a free tier as `id:free`; the suffix is a price,
 * not part of an id, so it is not carried here.
 *
 * A listed model that this deployment has no route or key for is not an error —
 * the chain builder skips it. That split is what makes a large pool safe: it
 * describes what could answer, while availability decides what may.
 */

import type { ModelId } from "../models";

export type RegistryTier = "coding" | "agent" | "reasoning" | "general";

/** What a request is asking for, before a model is chosen. */
export type TaskKind =
  | "coding"
  | "agent"
  | "reasoning"
  | "search"
  | "vision"
  | "general";

export type ModelProfile = {
  id: ModelId;
  tier: RegistryTier;
  /**
   * The task kinds this model should be chosen for, strongest first.
   *
   * The order is a preference, not a hard filter: a coding model that also fits
   * `general` is a fine fallback for a plain question and a poor one for a
   * screenshot.
   */
  fits: TaskKind[];
  /** Reads images. A vision request is never routed to a model without it. */
  vision: boolean;
  /** Has a web/search path of its own, rather than only its weights. */
  search: boolean;
  /** The context window this deployment relies on, in tokens. */
  contextTokens: number;
  /**
   * Ids this deployment may list the same model under.
   *
   * `deepseek-flash` is the catalogue's name for the model the registry lists
   * as `deepseek-v4.1-flash-1017`. The alias is how Auto finds it without
   * renaming a row that already exists in the database.
   */
  aliases?: ModelId[];
};

export const MODEL_REGISTRY: ModelProfile[] = [
  // Coding-specialized (5)
  {
    id: "qwen3-coder-plus",
    tier: "coding",
    fits: ["coding", "reasoning"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "codestral-latest",
    tier: "coding",
    fits: ["coding"],
    vision: false,
    search: false,
    contextTokens: 256_000,
  },
  {
    id: "qwen2.5-coder-32b",
    tier: "coding",
    fits: ["coding"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "north-mini-code",
    tier: "coding",
    fits: ["coding", "agent"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "swe-1-6-slow",
    tier: "coding",
    fits: ["coding", "reasoning"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },

  // Agent, web search and computer use (4)
  {
    id: "gpt-6-luna",
    tier: "agent",
    fits: ["agent", "search", "vision", "general"],
    vision: true,
    search: true,
    contextTokens: 1_100_000,
  },
  {
    id: "gemini-3.6-flash",
    tier: "agent",
    fits: ["agent", "search", "vision", "general"],
    vision: true,
    search: true,
    contextTokens: 1_000_000,
  },
  {
    id: "gemini-3.5-flash-lite",
    tier: "agent",
    fits: ["agent", "search", "vision", "general"],
    vision: true,
    search: true,
    contextTokens: 1_000_000,
  },
  {
    id: "gpt-4o",
    tier: "agent",
    fits: ["agent", "search", "vision", "general"],
    vision: true,
    search: true,
    contextTokens: 128_000,
  },

  // Reasoning and thinking specialists (18)
  {
    id: "deepseek-v4.1-flash-1017",
    tier: "reasoning",
    fits: ["reasoning", "coding"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
    aliases: ["deepseek-flash"],
  },
  {
    id: "minimax-m3.1-flash",
    tier: "reasoning",
    fits: ["reasoning", "general"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "step-5-preview",
    tier: "reasoning",
    fits: ["reasoning"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "glm-5.3-flash",
    tier: "reasoning",
    fits: ["reasoning", "general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "glm-5.3-flash-thinking",
    tier: "reasoning",
    fits: ["reasoning"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "glm-5.3-flash-search",
    tier: "reasoning",
    fits: ["search", "reasoning"],
    vision: false,
    search: true,
    contextTokens: 128_000,
  },
  {
    id: "glm-5.3-flash-think-search",
    tier: "reasoning",
    fits: ["search", "reasoning"],
    vision: false,
    search: true,
    contextTokens: 128_000,
  },
  {
    id: "nemotron-3-super-120b-a12b",
    tier: "reasoning",
    fits: ["reasoning", "general"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "beam",
    tier: "reasoning",
    fits: ["reasoning"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "intern-s2",
    tier: "reasoning",
    fits: ["reasoning"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "intern-s2-preview-397b",
    tier: "reasoning",
    fits: ["reasoning", "general"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "intern-s2-preview-35b",
    tier: "reasoning",
    fits: ["reasoning"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "intern-s1-pro",
    tier: "reasoning",
    fits: ["reasoning"],
    vision: false,
    search: false,
    contextTokens: 512_000,
  },
  {
    id: "intern-s1",
    tier: "reasoning",
    fits: ["reasoning"],
    vision: false,
    search: false,
    contextTokens: 512_000,
  },
  {
    id: "intern-s1-mini",
    tier: "reasoning",
    fits: ["reasoning", "general"],
    vision: false,
    search: false,
    contextTokens: 262_144,
  },
  {
    id: "mistral-small",
    tier: "reasoning",
    fits: ["reasoning", "general"],
    vision: false,
    search: false,
    contextTokens: 262_144,
  },
  {
    id: "hy3",
    tier: "reasoning",
    fits: ["reasoning"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "laguna-xs-2.1",
    tier: "reasoning",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },

  // Multimodal, vision and general MoE fallbacks (23)
  {
    id: "qwen3.8-27b",
    tier: "general",
    fits: ["general", "coding"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "qwen3.6-35b-a3b",
    tier: "general",
    fits: ["general", "coding"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "qwen3.6-27b",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "qwen3.5-397b-a17b",
    tier: "general",
    fits: ["general", "reasoning"],
    vision: false,
    search: false,
    contextTokens: 256_000,
  },
  {
    id: "qwen3.5-9b",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "qwen3.5-4b",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "qwen3",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "nemotron-3-ultra-550b-a55b",
    tier: "general",
    fits: ["general", "reasoning"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "nemotron-3.5-lightning-30b-a3b",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "nemotron-3.5-super-vl",
    tier: "general",
    fits: ["vision", "general"],
    vision: true,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "mimo-v2.6-flash",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "mistral-small-4-119b-2603",
    tier: "general",
    fits: ["general", "reasoning"],
    vision: false,
    search: false,
    contextTokens: 256_000,
  },
  {
    id: "mistral-small-3.2",
    tier: "general",
    fits: ["vision", "general"],
    vision: true,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "gpt-oss-120b",
    tier: "general",
    fits: ["general", "coding"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "gpt-oss-20b",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "gpt-oss-safeguard-20b",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "glm-4.7-flash",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "glm-4.6v-flash",
    tier: "general",
    fits: ["vision", "general"],
    vision: true,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "glm-4.5-flash",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "llama-4-scout",
    tier: "general",
    fits: ["vision", "general"],
    vision: true,
    search: false,
    contextTokens: 128_000,
  },
  {
    id: "cohere-command-a",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 256_000,
  },
  {
    id: "agnes-3.0-flash",
    tier: "general",
    fits: ["general"],
    vision: false,
    search: false,
    contextTokens: 1_000_000,
  },
  {
    id: "agnes-2.5-flash",
    tier: "general",
    fits: ["reasoning", "general"],
    vision: false,
    search: false,
    contextTokens: 512_000,
  },
];

/** The registry entry a model id (or one of its aliases) belongs to. */
export function profileForModel(
  id: ModelId,
  registry: readonly ModelProfile[] = MODEL_REGISTRY
): ModelProfile | undefined {
  return registry.find(
    (profile) => profile.id === id || profile.aliases?.includes(id) === true
  );
}
