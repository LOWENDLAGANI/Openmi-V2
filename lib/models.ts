/**
 * The model catalogue the browser is allowed to see.
 *
 * Display names are public on purpose: the picker shows a model name ("GPT OSS
 * 120B", "DeepSeek V4.1 flash"), not a capability alias. What stays server-only is the
 * vendor, the upstream id, the endpoint and the key — those live in
 * lib/models/routes.ts and lib/providers.ts, which no client component imports.
 *
 * A model that is not in this list can be added with a CUSTOM_MODELS entry at
 * deploy time; see lib/models/custom.ts. That is a configuration change, not a
 * code change, and it still never reaches the browser's routing logic.
 */

export type ModelId = string;

export type ModelCategory = "general" | "coding" | "reasoning";

/** The order the picker groups models in, with the heading each group shows. */
export const MODEL_CATEGORIES: { id: ModelCategory; label: string }[] = [
  { id: "general", label: "General" },
  { id: "coding", label: "Coding" },
  { id: "reasoning", label: "Reasoning" },
];

export function isModelCategory(value: unknown): value is ModelCategory {
  return (
    typeof value === "string" &&
    MODEL_CATEGORIES.some((category) => category.id === value)
  );
}

export type ModelCapability = {
  id: ModelId;
  /** What the picker shows: the model's name. */
  name: string;
  /** Which group the picker lists it under. */
  category: ModelCategory;
  blurb: string;
  images: boolean;
  documents: boolean;
  /** Filled in on the server: is a key for this model's provider configured? */
  available?: boolean;
};

export const MODELS: ModelCapability[] = [
  {
    id: "gpt-oss-120b",
    name: "GPT OSS 120B",
    category: "general",
    blurb: "Open-weight model with quick tool use, good for repository browsing.",
    images: false,
    documents: false,
  },
  {
    id: "deepseek-flash",
    name: "DeepSeek V4.1 flash",
    category: "general",
    blurb: "DeepSeek's fast model, and the only DeepSeek model offered here.",
    images: false,
    documents: false,
  },
];

export const DEFAULT_MODEL: ModelId = "gpt-oss-120b";

const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function isModelId(value: unknown): value is ModelId {
  return typeof value === "string" && SLUG.test(value);
}

/** Exact membership in a catalogue, including custom entries. */
export function hasModel(
  catalogue: readonly ModelCapability[],
  value: unknown
): value is ModelId {
  return (
    typeof value === "string" &&
    catalogue.some((model) => model.id === value)
  );
}

export function modelName(
  id: ModelId,
  catalogue: readonly ModelCapability[] = MODELS
): string {
  return catalogue.find((model) => model.id === id)?.name ?? id;
}

/**
 * The model to open with when the requested one is gone.
 *
 * The first usable entry beats a fixed id: a deployment that set only the
 * DeepSeek key should not open on a Groq model it cannot call. A catalogue with
 * no availability probe yet treats every entry as usable.
 */
export function firstAvailableModel(
  catalogue: readonly ModelCapability[],
  fallback: ModelId = DEFAULT_MODEL
): ModelId {
  return catalogue.find((model) => model.available !== false)?.id ?? fallback;
}
