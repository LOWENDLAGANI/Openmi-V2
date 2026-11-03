import { expect, test } from "bun:test";

import { MODELS } from "../lib/models";
import { MAX_CUSTOM_MODELS, parseCustomModels } from "../lib/models/custom";
import { BUILTIN_ROUTES, routeForModel } from "../lib/models/routes";

test("every built-in model except auto has a provider route", () => {
  for (const model of MODELS) {
    if (model.id === "auto") continue;
    expect(BUILTIN_ROUTES[model.id]).toBeDefined();
  }

  expect(routeForModel("auto")).toBeNull();
  expect(routeForModel("nope")).toBeNull();
});

test("a well-formed custom model parses and routes", () => {
  const raw = JSON.stringify([
    {
      id: "my-model",
      name: "My Model",
      provider: "openrouter",
      upstream: "vendor/model-id",
    },
  ]);

  const { models, errors } = parseCustomModels(raw);

  expect(errors).toEqual([]);
  expect(models).toHaveLength(1);
  expect(models[0]?.blurb).toBe("Custom model added by this deployment.");
  expect(routeForModel("my-model", models)).toEqual({
    provider: "openrouter",
    upstream: "vendor/model-id",
  });
});

test("a built-in id cannot be redefined by a custom entry", () => {
  const { models } = parseCustomModels(
    JSON.stringify([
      {
        id: "glm-4.6",
        name: "Impostor",
        provider: "groq",
        upstream: "someone/else",
      },
    ])
  );

  expect(routeForModel("glm-4.6", models)).toEqual(BUILTIN_ROUTES["glm-4.6"]);
});

test("bad configuration is reported, never thrown", () => {
  expect(parseCustomModels(undefined)).toEqual({ models: [], errors: [] });
  expect(parseCustomModels("  ")).toEqual({ models: [], errors: [] });

  expect(parseCustomModels("{not json").models).toEqual([]);
  expect(parseCustomModels("{}").errors.length).toBe(1);

  const invalid = JSON.stringify([
    { id: "Bad Id", name: "X", provider: "openrouter", upstream: "a/b" },
    { id: "ok-id", name: "", provider: "openrouter", upstream: "a/b" },
    { id: "other", name: "Other", provider: "nope", upstream: "a/b" },
    { id: "fourth", name: "Fourth", provider: "groq", upstream: "a b" },
  ]);

  const result = parseCustomModels(invalid);
  expect(result.models).toEqual([]);
  expect(result.errors).toHaveLength(4);
});

test("custom entries are deduplicated and capped", () => {
  const duplicated = parseCustomModels(
    JSON.stringify([
      { id: "same", name: "One", provider: "groq", upstream: "a/b" },
      { id: "same", name: "Two", provider: "groq", upstream: "a/b" },
    ])
  );

  expect(duplicated.models).toHaveLength(1);
  expect(duplicated.errors.some((error) => error.includes("duplicate"))).toBe(true);

  const many = Array.from({ length: MAX_CUSTOM_MODELS + 5 }, (_, index) => ({
    id: `model-${index}`,
    name: `Model ${index}`,
    provider: "groq",
    upstream: "a/b",
  }));

  const capped = parseCustomModels(JSON.stringify(many));
  expect(capped.models).toHaveLength(MAX_CUSTOM_MODELS);
  expect(capped.errors.some((error) => error.includes("only the first"))).toBe(true);
});
