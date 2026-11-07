import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import {
  DEFAULT_MODEL,
  MODELS,
  hasModel,
  isModelId,
  modelHourDew,
  modelName,
} from "../lib/models";

const MODELS_SOURCE = readFileSync(
  new URL("../lib/models.ts", import.meta.url),
  "utf8"
);

// The prose may name the concepts it is excluding; only executable code is
// scanned.
const MODELS_CODE = MODELS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "");

test("the picker offers Auto and the one model this deployment serves", () => {
  expect(MODELS.map((model) => model.id)).toEqual(["auto", "deepseek-flash"]);
  expect(DEFAULT_MODEL).toBe("deepseek-flash");
  expect(MODELS.map((model) => model.name)).toEqual([
    "Auto",
    "DeepSeek V4.1 flash",
  ]);
  expect(modelName("auto")).toBe("Auto");
  expect(modelName("deepseek-flash")).toBe("DeepSeek V4.1 flash");
  expect(modelName("unknown-model")).toBe("unknown-model");

  // Auto is a real entry now; the retired concrete models are still gone.
  expect(hasModel(MODELS, "auto")).toBe(true);
  for (const gone of [
    "glm-4.6",
    "qwen3-coder",
    "kimi-k2",
    "deepseek-chat",
    "deepseek-reasoner",
    "gpt-oss-120b",
  ]) {
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

test("every model prices its own hour, and the built-ins cost the same today", () => {
  for (const model of MODELS) {
    expect(Number.isFinite(model.dewPerHour)).toBe(true);
    expect(model.dewPerHour).toBeGreaterThan(0);
  }

  expect(modelHourDew("deepseek-flash")).toBe(2);
  expect(modelHourDew("auto")).toBe(2);

  // A model the catalogue does not know is charged the default, never nothing:
  // a missing price must not become a free hour.
  expect(modelHourDew("not-a-model")).toBe(MODELS[0].dewPerHour);
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
