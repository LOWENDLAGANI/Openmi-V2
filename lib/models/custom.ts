/**
 * Models added at deploy time.
 *
 * `CUSTOM_MODELS` is a JSON array; each entry names a model the built-in
 * catalogue does not cover and says which provider serves it:
 *
 *   [{"id":"my-model","name":"My Model","provider":"openrouter",
 *     "upstream":"vendor/model-id","category":"coding"}]
 *
 * `category` is optional and defaults to "general".
 *
 * The parser never throws and never trusts the file: a bad entry is reported by
 * index and skipped, so one typo cannot take the whole picker down. Provider,
 * upstream id and key stay on the server — only `id` and `name` are handed to
 * the browser.
 */

import {
  MODEL_CATEGORIES,
  isModelCategory,
  type ModelCategory,
} from "../models";

export const CUSTOM_MODEL_PROVIDERS = ["openrouter", "deepseek"] as const;

export type CustomProvider = (typeof CUSTOM_MODEL_PROVIDERS)[number];

export type CustomModel = {
  id: string;
  name: string;
  category: ModelCategory;
  provider: CustomProvider;
  upstream: string;
  blurb: string;
};

export const MAX_CUSTOM_MODELS = 20;

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const NAME_MAX = 48;
const UPSTREAM = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is CustomProvider {
  return (
    typeof value === "string" &&
    (CUSTOM_MODEL_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * Returns the valid entries plus one message per rejected entry. Errors are for
 * the operator (setup page, logs), never for the visitor.
 */
export function parseCustomModels(raw: string | undefined): {
  models: CustomModel[];
  errors: string[];
} {
  const text = (raw ?? "").trim();
  if (text.length === 0) return { models: [], errors: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      models: [],
      errors: ["CUSTOM_MODELS is not valid JSON; every custom model was ignored."],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      models: [],
      errors: ["CUSTOM_MODELS must be a JSON array of model objects."],
    };
  }

  const errors: string[] = [];
  const models: CustomModel[] = [];
  const seen = new Set<string>();

  if (parsed.length > MAX_CUSTOM_MODELS) {
    errors.push(
      `CUSTOM_MODELS has ${parsed.length} entries; only the first ${MAX_CUSTOM_MODELS} are read.`
    );
  }

  parsed.slice(0, MAX_CUSTOM_MODELS).forEach((entry, index) => {
    const at = `custom model ${index + 1}`;

    if (!isRecord(entry)) {
      errors.push(`${at}: expected an object.`);
      return;
    }

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    if (!ID.test(id)) {
      errors.push(`${at}: id must be a lowercase slug (a-z, 0-9, dot, dash).`);
      return;
    }

    if (seen.has(id)) {
      errors.push(`${at}: duplicate id "${id}".`);
      return;
    }

    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (name.length === 0 || name.length > NAME_MAX) {
      errors.push(`${at}: name must be 1–${NAME_MAX} characters.`);
      return;
    }

    const category = entry.category === undefined ? "general" : entry.category;
    if (!isModelCategory(category)) {
      errors.push(
        `${at}: category must be one of ${MODEL_CATEGORIES.map(
          (option) => option.id
        ).join(", ")}.`
      );
      return;
    }

    if (!isProvider(entry.provider)) {
      errors.push(
        `${at}: provider must be one of ${CUSTOM_MODEL_PROVIDERS.join(", ")}.`
      );
      return;
    }

    const upstream =
      typeof entry.upstream === "string" ? entry.upstream.trim() : "";
    if (!UPSTREAM.test(upstream)) {
      errors.push(`${at}: upstream must be a provider model id.`);
      return;
    }

    const blurb =
      typeof entry.blurb === "string" && entry.blurb.trim().length > 0
        ? entry.blurb.trim().slice(0, 120)
        : "Custom model added by this deployment.";

    seen.add(id);
    models.push({ id, name, category, provider: entry.provider, upstream, blurb });
  });

  return { models, errors };
}
