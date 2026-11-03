import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import {
  DEFAULT_MODEL,
  MODELS,
  hasModel,
  isModelId,
  modelName,
} from "../lib/models";

const MODELS_SOURCE = readFileSync(
  new URL("../lib/models.ts", import.meta.url),
  "utf8"
);

// The prose may name the concepts it is excluding; only executable code is
// scanned.
const MODELS_CODE = MODELS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "");

test("the picker offers model names, with Auto first and as the default", () => {
  const names = MODELS.map((model) => model.name);

  expect(MODELS[0]?.id).toBe("auto");
  expect(DEFAULT_MODEL).toBe("auto");
  expect(names).toContain("GPT OSS 120B");
  expect(names).toContain("GLM 4.6");
  expect(names).toContain("DeepSeek V3");
  expect(modelName("glm-4.6")).toBe("GLM 4.6");
  expect(modelName("unknown-model")).toBe("unknown-model");
});

test("ids are lowercase slugs and lookups are exact", () => {
  for (const model of MODELS) {
    expect(isModelId(model.id)).toBe(true);
  }

  expect(isModelId("qwen3-coder")).toBe(true);
  expect(isModelId("Auto")).toBe(false);
  expect(isModelId("../etc/passwd")).toBe(false);
  expect(isModelId("with space")).toBe(false);
  expect(isModelId(undefined)).toBe(false);
  expect(isModelId(42)).toBe(false);

  expect(hasModel(MODELS, "deepseek-chat")).toBe(true);
  expect(hasModel(MODELS, "deepseek-chat-v9")).toBe(false);
});

test("the browser catalogue carries no endpoint, upstream id or key", () => {
  for (const token of [
    "http",
    "API_KEY",
    "upstream",
    "endpoint",
    "process.env",
    "routeForModel",
  ]) {
    expect(MODELS_CODE).not.toContain(token);
  }
});

test("no component claims a build or a test ran", () => {
  const dir = new URL("../components/", import.meta.url);
  const files = readdirSync(dir).filter((file) => file.endsWith(".tsx"));

  for (const file of files) {
    const source = readFileSync(new URL(file, dir), "utf8").toLowerCase();
    expect(source).not.toContain("tests passed");
    expect(source).not.toContain("build passed");
    expect(source).not.toContain("all tests");
  }
});
