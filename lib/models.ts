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

import { DEW_PER_HOUR } from "./dew";

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
  /**
   * What an hour of chat on this model costs.
   *
   * The hour is charged before the provider is called and belongs to the model
   * that was chosen, so the price belongs to the model too. The number here and
   * `model_hour_dew` in the database are the same decision, and a test reads
   * both.
   */
  dewPerHour: number;
  /** Filled in on the server: is a key for this model's provider configured? */
  available?: boolean;
};

/** The router's own picker entry: a model with a queue behind it, not a route. */
export const AUTO_MODEL: ModelId = "auto";

export const MODELS: ModelCapability[] = [
  {
    id: AUTO_MODEL,
    name: "Auto",
    category: "general",
    blurb: "Reads each message, picks the model that fits it, and moves on if one drops.",
    images: false,
    documents: false,
    // An Auto hour costs one price whatever answers it: the picker sells the
    // hour, and `model_hour_dew('auto')` in the database agrees.
    dewPerHour: 2,
  },
  {
    id: "gpt-oss-120b",
    name: "GPT OSS 120B",
    category: "general",
    blurb: "Open-weight model with quick tool use, good for repository browsing.",
    images: false,
    documents: false,
    dewPerHour: 2,
  },
  {
    id: "deepseek-flash",
    name: "DeepSeek V4.1 flash",
    category: "general",
    blurb: "DeepSeek's fast model, and the only DeepSeek model offered here.",
    images: false,
    documents: false,
    // Kept level with GPT OSS: the hour is the chat, not the model's list price,
    // and charging DeepSeek more would need a reason the ledger cannot explain.
    dewPerHour: 2,
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
 * What an hour on this model costs.
 *
 * An unknown id is charged the catalogue default rather than nothing: a price
 * the picker cannot find must never become a free hour.
 */
export function modelHourDew(
  id: ModelId,
  catalogue: readonly ModelCapability[] = MODELS
): number {
  return catalogue.find((model) => model.id === id)?.dewPerHour ?? DEW_PER_HOUR;
}

/**
 * The model to open with when the requested one is gone.
 *
 * The first usable entry beats a fixed id: a deployment that set only the
 * DeepSeek key should not open on a Groq model it cannot call. A catalogue with
 * no availability probe yet treats every entry as usable.
 *
 * Auto is skipped while a concrete model is usable. Routing is a deliberate
 * choice, so an existing chat keeps opening on the same kind of model it opened
 * on before; when Auto is all that is left it is still better than an id whose
 * key is missing.
 */
export function firstAvailableModel(
  catalogue: readonly ModelCapability[],
  fallback: ModelId = DEFAULT_MODEL
): ModelId {
  const usable = catalogue.filter((model) => model.available !== false);

  return (
    usable.find((model) => model.id !== AUTO_MODEL)?.id ??
    usable[0]?.id ??
    fallback
  );
}
