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

test("the picker offers exactly the two models this deployment serves", () => {
  expect(MODELS.map((model) => model.id)).toEqual([
    "gpt-oss-120b",
    "deepseek-flash",
  ]);
  expect(DEFAULT_MODEL).toBe("gpt-oss-120b");
  expect(MODELS.map((model) => model.name)).toEqual([
    "GPT OSS 120B",
    "DeepSeek V4.1 flash",
  ]);
  expect(modelName("deepseek-flash")).toBe("DeepSeek V4.1 flash");
  expect(modelName("unknown-model")).toBe("unknown-model");

  // The retired entries are gone, not hidden behind an alias.
  for (const gone of ["auto", "glm-4.6", "qwen3-coder", "kimi-k2", "deepseek-chat", "deepseek-reasoner"]) {
    expect(hasModel(MODELS, gone)).toBe(false);
  }
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

  expect(hasModel(MODELS, "deepseek-flash")).toBe(true);
  expect(hasModel(MODELS, "deepseek-flash-v9")).toBe(false);
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
