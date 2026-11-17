/**
 * The model catalogue the browser is allowed to see.
 *
 * Display names are public on purpose: the picker shows a model name ("DeepSeek
 * V4.1 flash"), not a capability alias. What stays server-only is the
 * vendor, the upstream id, the endpoint and the key — those live in
 * lib/models/routes.ts and lib/providers.ts, which no client component imports.
 *
 * A model that is not in this list can be added with a CUSTOM_MODELS entry at
 * deploy time; see lib/models/custom.ts. That is a configuration change, not a
 * code change, and it still never reaches the browser's routing logic.
 */

import { CREDIT_PER_HOUR } from "./credits";

// Thinking effort is its own vocabulary, shared by the picker and the worker, so
// it lives in one pure module and is re-exported here for the components that
// already import the catalogue.
export {
  DEFAULT_REASONING_EFFORT,
  EFFORT_MODELS,
  REASONING_EFFORTS,
  effortOrDefault,
  isReasoningEffort,
  modelSupportsEffort,
  type ReasoningEffort,
} from "./models/effort";

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
   * Only a live paid pass may answer with this model.
   *
   * The flag is public because the picker has to show the lock; it is never the
   * authority. `paid_until` is checked on the server before an hour is charged,
   * and `hour_sessions` refuses the row in the database, so hiding or editing
   * this flag in a browser buys nothing.
   */
  paidOnly?: boolean;
  /**
   * Only an operator may see this model or call it.
   *
   * The flag is a display rule for this browser and a second check on the
   * server: `modelsForReader` is what keeps it out of the picker, and the chat,
   * run and mission routes refuse it again before a row or an hour exists. A
   * forged picker buys nothing either way.
   */
  adminOnly?: boolean;
  /**
   * What an hour of chat on this model costs.
   *
   * The hour is charged before the provider is called and belongs to the model
   * that was chosen, so the price belongs to the model too. The number here and
   * `model_hour_credit` in the database are the same decision, and a test reads
   * both.
   */
  creditPerHour: number;
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
    // Auto answers with free models, so its hour is free: the picker shows 0
    // and `model_hour_credit('auto')` in the database agrees. Free is a price,
    // not an exemption — the hour still starts and still scopes the chat.
    creditPerHour: 0,
  },
  {
    id: "deepseek-flash",
    name: "DeepSeek V4.1 flash",
    category: "general",
    blurb: "DeepSeek's fast model, and the only DeepSeek model offered here.",
    images: false,
    documents: false,
    // The catalogue's priced model, and what `CREDIT_PER_HOUR` documents.
    creditPerHour: 3,
  },
  {
    id: "claude-haiku",
    name: "Claude Haiku 4.5",
    category: "general",
    blurb: "Anthropic's fast model, for paid passes only.",
    images: false,
    documents: false,
    // Premium access is an entitlement, not a different price: the hour costs
    // what every other named model costs.
    creditPerHour: 3,
    paidOnly: true,
  },
  {
    id: "gpt-oss",
    name: "GPT-OSS 120B",
    category: "general",
    blurb: "OpenAI's open-weight model, served through Straitly.",
    images: false,
    documents: false,
    creditPerHour: 3,
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    category: "general",
    blurb: "Served through the Experiential gateway. Operators only.",
    images: false,
    documents: false,
    // The generic hour: the database prices an unlisted id the same way, so this
    // is documentation as much as a number.
    creditPerHour: 3,
    adminOnly: true,
  },
];

export const DEFAULT_MODEL: ModelId = "deepseek-flash";

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
export function modelHourCredit(
  id: ModelId,
  catalogue: readonly ModelCapability[] = MODELS
): number {
  return catalogue.find((model) => model.id === id)?.creditPerHour ?? CREDIT_PER_HOUR;
}

/** True when this model is reserved for an operator account. */
export function modelRequiresAdmin(
  id: ModelId,
  catalogue: readonly ModelCapability[] = MODELS
): boolean {
  return catalogue.find((model) => model.id === id)?.adminOnly === true;
}

/**
 * The catalogue a reader's picker may show.
 *
 * Operators see the operator-only entries; nobody else is told they exist. This
 * is the display half; the refusal below is the half that matters.
 */
export function modelsForReader(
  catalogue: readonly ModelCapability[],
  isAdmin: boolean
): ModelCapability[] {
  return catalogue.filter((model) => !model.adminOnly || isAdmin);
}

/**
 * The refusal an operator-only model produces, or null when it is allowed.
 *
 * The same shape as `paidOnlyRefusal` so a route can treat both refusals the
 * same way, and a test can prove the picker and the server agree about who may
 * call it.
 */
export function adminOnlyRefusal(
  id: ModelId,
  isAdmin: boolean,
  catalogue: readonly ModelCapability[] = MODELS
): { error: string; code: "admin-only" } | null {
  if (!modelRequiresAdmin(id, catalogue) || isAdmin) return null;

  return {
    error: `${modelName(id, catalogue)} is an operator-only model.`,
    code: "admin-only",
  };
}

/** True when this model is sold as part of a paid pass. */
export function modelRequiresPaid(
  id: ModelId,
  catalogue: readonly ModelCapability[] = MODELS
): boolean {
  return catalogue.find((model) => model.id === id)?.paidOnly === true;
}

/** Whether this account may pick this model right now. */
export function isModelAllowed(
  id: ModelId,
  paidActive: boolean,
  catalogue: readonly ModelCapability[] = MODELS
): boolean {
  return !modelRequiresPaid(id, catalogue) || paidActive;
}

/**
 * The refusal a paid-only model produces, or null when it is allowed.
 *
 * One sentence, decided by a pure function, so the route that charges the hour
 * and the picker that offers it cannot disagree about who may use it.
 */
export function paidOnlyRefusal(
  id: ModelId,
  paidActive: boolean,
  catalogue: readonly ModelCapability[] = MODELS
): { error: string; code: "paid-only" } | null {
  if (isModelAllowed(id, paidActive, catalogue)) return null;

  return {
    error: `${modelName(id, catalogue)} is part of the paid plan. Start a pass on Plans, then pick it again.`,
    code: "paid-only",
  };
}

/**
 * The model to open with when the requested one is gone.
 *
 * The first usable entry beats a fixed id: a deployment whose only callable
 * model is a custom entry should not open on a built-in whose key is missing. A
 * catalogue with no availability probe yet treats every entry as usable.
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
