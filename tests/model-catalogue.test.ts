import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  AUTO_MODEL,
  DEFAULT_MODEL,
  MODELS,
  MODEL_CATEGORIES,
  firstAvailableModel,
} from "../lib/models";
import { MAX_CUSTOM_MODELS, parseCustomModels } from "../lib/models/custom";
import { AUTO_ROUTES, BUILTIN_ROUTES, routeForModel } from "../lib/models/routes";

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
  const [auto, deepseek] = MODELS;

  const catalogue = [
    { ...auto!, available: false },
    { ...deepseek!, available: true },
  ];

  expect(firstAvailableModel(catalogue)).toBe("deepseek-flash");
  expect(firstAvailableModel([])).toBe(DEFAULT_MODEL);

  // Auto is a choice, not a silent default: a chat still opens on a concrete
  // model when one is callable.
  expect(firstAvailableModel(MODELS)).toBe("deepseek-flash");
  expect(firstAvailableModel([{ ...auto!, available: true }])).toBe("auto");
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
        provider: "deepseek",
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
        provider: "deepseek",
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

test("every built-in model has a provider route, and Auto has a queue", () => {
  for (const model of MODELS) {
    if (model.id === AUTO_MODEL) {
      // Auto is not one endpoint, so it has no single route to point at; its
      // queue is built in lib/providers.ts.
      expect(routeForModel(model.id)).toBeNull();
      continue;
    }

    expect(BUILTIN_ROUTES[model.id]).toBeDefined();
  }

  // Retired ids have no route and are not silently remapped by the router; the
  // chat route is the one place that maps an unknown id to the default model.
  expect(routeForModel("glm-4.6")).toBeNull();
  expect(routeForModel("nope")).toBeNull();
});

test("the paid-only model is one Straitly route, with no free fallback", () => {
  // A paid model that failed over to a free one would answer with something the
  // reader did not buy; the route is deliberately a single provider.
  expect(BUILTIN_ROUTES["claude-haiku"]).toEqual({
    provider: "straitly",
    upstream: "claude-haiku-4-5",
  });
  expect(AUTO_ROUTES["claude-haiku"]).toBeUndefined();
});

test("GPT-OSS is one Straitly route, and Auto keeps its open-weight pool", () => {
  // The named model is served by Straitly and nothing else: the reader picked
  // it, so a silent failover would answer from a model they did not choose.
  expect(BUILTIN_ROUTES["gpt-oss"]).toEqual({
    provider: "straitly",
    upstream: "openai/gpt-oss-120b",
  });

  // Auto's UnoRouter pool has had its own gpt-oss entries all along; they are
  // different ids and none of them is remapped by naming the model here.
  expect(AUTO_ROUTES["gpt-oss-120b"]).toEqual({
    provider: "openrouter",
    upstream: "gpt-oss-120b:free",
  });
  expect(AUTO_ROUTES["gpt-oss"]).toBeUndefined();
});

test("the operator-only model is one Experiential route, at the gateway's own id", () => {
  // The gateway does the routing, so the picker id, the upstream id and the
  // gateway's model id are one string. No fallback: answering from another
  // model is what the operator did not ask for.
  expect(BUILTIN_ROUTES["gpt-6-luna"]).toEqual({
    provider: "experiential",
    upstream: "gpt-6-luna",
  });

  // Auto's free pool still lists its own `gpt-6-luna`, untouched.
  expect(AUTO_ROUTES["gpt-6-luna"]).toEqual({
    provider: "openrouter",
    upstream: "gpt-6-luna:free",
  });
});

test("the gateway is one endpoint, one key name, one model id", () => {
  const source = readFileSync(
    new URL("../lib/providers.ts", import.meta.url),
    "utf8"
  );

  expect(source).toContain(
    'endpoint: "https://api.experientiallabs.ai/v1/chat/completions"'
  );
  expect(source).toContain('model: "gpt-6-luna"');
  expect(source).toContain('keyName: "EXPLABS_API_KEY"');
});

test("DeepSeek is one named model with a Straitly-first fallback chain", () => {
  const deepseek = MODELS.filter((model) => model.id === "deepseek-flash");

  expect(deepseek.map((model) => model.id)).toEqual(["deepseek-flash"]);
  expect(BUILTIN_ROUTES["deepseek-flash"]).toEqual({
    provider: "straitly",
    upstream: "deepseek-v4-1-flash-1017",
  });
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
        provider: "openrouter",
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
    { id: "fourth", name: "Fourth", provider: "deepseek", upstream: "a b" },
  ]);

  const result = parseCustomModels(invalid);
  expect(result.models).toEqual([]);
  expect(result.errors).toHaveLength(4);
});

test("custom entries are deduplicated and capped", () => {
  const duplicated = parseCustomModels(
    JSON.stringify([
      { id: "same", name: "One", provider: "deepseek", upstream: "a/b" },
      { id: "same", name: "Two", provider: "deepseek", upstream: "a/b" },
    ])
  );

  expect(duplicated.models).toHaveLength(1);
  expect(duplicated.errors.some((error) => error.includes("duplicate"))).toBe(true);

  const many = Array.from({ length: MAX_CUSTOM_MODELS + 5 }, (_, index) => ({
    id: `model-${index}`,
    name: `Model ${index}`,
    provider: "deepseek",
    upstream: "a/b",
  }));

  const capped = parseCustomModels(JSON.stringify(many));
  expect(capped.models).toHaveLength(MAX_CUSTOM_MODELS);
  expect(capped.errors.some((error) => error.includes("only the first"))).toBe(true);
});
