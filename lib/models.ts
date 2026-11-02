/**
 * What the browser is allowed to know about models.
 *
 * Capability ids, display names and what each mode is for. No vendor name, no
 * model id and no endpoint appears here: those live in lib/providers.ts, which
 * is server-only and never reaches a client bundle.
 *
 * tests/models.test.ts reads this file and fails on any vendor name, which is a
 * cheaper guarantee than a reviewer remembering not to add one.
 */

export type ModelId = "auto" | "code" | "flash";

export type ModelCapability = {
  id: ModelId;
  name: string;
  blurb: string;
  /** Whether a provider in this deployment can accept image input. */
  images: boolean;
  /** Whether a provider in this deployment can accept document input. */
  documents: boolean;
};

export const MODELS: ModelCapability[] = [
  {
    id: "auto",
    name: "Auto",
    blurb: "Reads the repository and picks a provider per request, with a fallback.",
    images: false,
    documents: false,
  },
  {
    id: "code",
    name: "Code",
    blurb: "Slower and more literal; better at following a call chain.",
    images: false,
    documents: false,
  },
  {
    id: "flash",
    name: "Flash",
    blurb: "Fastest and cheapest, for small questions about one file.",
    images: false,
    documents: false,
  },
];

export const DEFAULT_MODEL: ModelId = "auto";

export function isModelId(value: unknown): value is ModelId {
  return value === "auto" || value === "code" || value === "flash";
}

export function modelName(id: ModelId): string {
  return MODELS.find((model) => model.id === id)?.name ?? id;
}
