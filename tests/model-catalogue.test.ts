import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  DEFAULT_MODEL,
  MODELS,
  MODEL_CATEGORIES,
  firstAvailableModel,
} from "../lib/models";
import { MAX_CUSTOM_MODELS, parseCustomModels } from "../lib/models/custom";
import { BUILTIN_ROUTES, routeForModel } from "../lib/models/routes";

test("every built-in model has a category the picker can group", () => {
  const ids = MODEL_CATEGORIES.map((category) => category.id);

  for (const model of MODELS) {
    expect(ids).toContain(model.category);
  }

  expect(MODEL_CATEGORIES.map((category) => category.label)).toEqual([
    "General",
    "Coding",
    "Reasoning",
  ]);
});

test("the opening model is one the deployment can call", () => {
  const catalogue = [
    { ...MODELS[0]!, available: false },
    { ...MODELS[1]!, available: true },
  ];

  expect(firstAvailableModel(catalogue)).toBe("deepseek-flash");
  expect(firstAvailableModel([])).toBe(DEFAULT_MODEL);

  // Without a probe yet, the first entry is as good as any.
  expect(firstAvailableModel(MODELS)).toBe(MODELS[0]?.id ?? DEFAULT_MODEL);
});

test("a custom model picks its own category and defaults to general", () => {
  const parsed = parseCustomModels(
    JSON.stringify([
      {
        id: "coder-x",
        name: "Coder X",
        category: "coding",
        provider: "openrouter",
        upstream: "vendor/coder-x",
      },
      {
        id: "plain-x",
        name: "Plain X",
        provider: "groq",
        upstream: "vendor/plain-x",
      },
    ])
  );

  expect(parsed.errors).toEqual([]);
  expect(parsed.models[0]?.category).toBe("coding");
  expect(parsed.models[1]?.category).toBe("general");
});

test("an unknown custom category is rejected, not guessed", () => {
  const parsed = parseCustomModels(
    JSON.stringify([
      {
        id: "odd",
        name: "Odd",
        category: "fastest",
        provider: "groq",
        upstream: "a/b",
      },
    ])
  );

  expect(parsed.models).toEqual([]);
  expect(parsed.errors[0]).toContain("category");
});

test("the picker renders one group per category", () => {
  // The picker is its own popover now, not a native <select>: the grouping lives
  // where the list is rendered.
  const menu = readFileSync(
    new URL("../components/ModelMenu.tsx", import.meta.url),
    "utf8"
  );

  expect(menu).toContain("MODEL_CATEGORIES.map");
  expect(menu).toContain('role="listbox"');
  expect(menu).toContain('role="option"');
  expect(menu).toContain("{group.label}");
});

test("every built-in model has a provider route", () => {
  for (const model of MODELS) {
    expect(BUILTIN_ROUTES[model.id]).toBeDefined();
  }

  // Retired ids have no route and are not silently remapped by the router; the
  // chat route is the one place that maps an unknown id to the default model.
  expect(routeForModel("auto")).toBeNull();
  expect(routeForModel("glm-4.6")).toBeNull();
  expect(routeForModel("nope")).toBeNull();
});

test("DeepSeek is one model, and it is deepseek-flash", () => {
  const deepseek = MODELS.filter(
    (model) => BUILTIN_ROUTES[model.id]?.provider === "deepseek"
  );

  expect(deepseek.map((model) => model.id)).toEqual(["deepseek-flash"]);
  expect(BUILTIN_ROUTES["deepseek-flash"]).toEqual({
    provider: "deepseek",
    upstream: "deepseek-flash",
  });

  // Groq stays on the one model it was locked to.
  const groq = MODELS.filter(
    (model) => BUILTIN_ROUTES[model.id]?.provider === "groq"
  );
  expect(groq.map((model) => model.id)).toEqual(["gpt-oss-120b"]);
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
        id: "deepseek-flash",
        name: "Impostor",
        provider: "groq",
        upstream: "someone/else",
      },
    ])
  );

  expect(routeForModel("deepseek-flash", models)).toEqual(
    BUILTIN_ROUTES["deepseek-flash"]
  );
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
