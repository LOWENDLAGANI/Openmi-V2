import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import { DEFAULT_MODEL, MODELS, isModelId } from "../lib/models";

const MODELS_SOURCE = readFileSync(new URL("../lib/models.ts", import.meta.url), "utf8");

const VENDORS = [
  "openrouter",
  "groq",
  "deepseek",
  "openai",
  "anthropic",
  "claude",
  "gemini",
  "llama",
  "mistral",
  "qwen",
  "gpt-",
];

test("the browser model catalogue names no vendor", () => {
  // The capability id is the contract. A vendor name here would end up in the
  // client bundle the moment a component imported this file.
  for (const vendor of VENDORS) {
    expect(MODELS_SOURCE.toLowerCase()).not.toContain(vendor);
  }
});

test("three capability modes are offered and auto is the default", () => {
  expect(MODELS.map((model) => model.id)).toEqual(["auto", "code", "flash"]);
  expect(DEFAULT_MODEL).toBe("auto");
  expect(isModelId("auto")).toBe(true);
  expect(isModelId("gpt-5")).toBe(false);
  expect(isModelId(undefined)).toBe(false);
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
