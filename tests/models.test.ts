import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

import { CREDIT_PER_HOUR } from "../lib/credits";
import {
  DEFAULT_MODEL,
  MODELS,
  adminOnlyRefusal,
  hasModel,
  isModelAllowed,
  isModelId,
  modelHourCredit,
  modelName,
  modelRequiresAdmin,
  modelRequiresPaid,
  modelsForReader,
  paidOnlyRefusal,
} from "../lib/models";

const MODELS_SOURCE = readFileSync(
  new URL("../lib/models.ts", import.meta.url),
  "utf8"
);

// The prose may name the concepts it is excluding; only executable code is
// scanned.
const MODELS_CODE = MODELS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "");

test("the picker offers Auto and the one model this deployment serves", () => {
  expect(MODELS.map((model) => model.id)).toEqual([
    "auto",
    "deepseek-flash",
    "claude-haiku",
    "gpt-6-luna",
  ]);
  expect(DEFAULT_MODEL).toBe("deepseek-flash");
  expect(MODELS.map((model) => model.name)).toEqual([
    "Auto",
    "DeepSeek V4.1 flash",
    "Claude Haiku 4.5",
    "GPT-6 Luna",
  ]);
  expect(modelName("auto")).toBe("Auto");
  expect(modelName("deepseek-flash")).toBe("DeepSeek V4.1 flash");
  expect(modelName("claude-haiku")).toBe("Claude Haiku 4.5");
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

test("every model prices its own hour: Auto free, DeepSeek the default", () => {
  for (const model of MODELS) {
    expect(Number.isFinite(model.creditPerHour)).toBe(true);
    // Zero is a price. A negative one would be a credit nobody asked for.
    expect(model.creditPerHour).toBeGreaterThanOrEqual(0);
  }

  expect(modelHourCredit("auto")).toBe(0);
  expect(modelHourCredit("deepseek-flash")).toBe(CREDIT_PER_HOUR);

  // A model the catalogue does not know is charged the default, never nothing:
  // a missing price must not become a free hour.
  expect(modelHourCredit("not-a-model")).toBe(CREDIT_PER_HOUR);
});

test("the paid-only model is marked, priced, and refused without a pass", () => {
  const haiku = MODELS.find((model) => model.id === "claude-haiku");

  expect(haiku?.paidOnly).toBe(true);
  // Premium is an entitlement, not a price: the hour costs the catalogue's.
  expect(haiku?.creditPerHour).toBe(CREDIT_PER_HOUR);

  for (const model of MODELS) {
    if (model.id === "claude-haiku") continue;
    expect(model.paidOnly).not.toBe(true);
  }

  expect(modelRequiresPaid("claude-haiku")).toBe(true);
  expect(modelRequiresPaid("deepseek-flash")).toBe(false);
  expect(modelRequiresPaid("not-a-model")).toBe(false);

  // A free model is never gated; the premium one is gated on a live pass.
  expect(isModelAllowed("deepseek-flash", false)).toBe(true);
  expect(isModelAllowed("claude-haiku", false)).toBe(false);
  expect(isModelAllowed("claude-haiku", true)).toBe(true);

  expect(paidOnlyRefusal("deepseek-flash", false)).toBeNull();
  expect(paidOnlyRefusal("claude-haiku", true)).toBeNull();

  const refusal = paidOnlyRefusal("claude-haiku", false);
  expect(refusal?.code).toBe("paid-only");
  expect(refusal?.error).toContain("paid plan");
});

test("the operator-only model is hidden from readers and refused on the server", () => {
  const luna = MODELS.find((model) => model.id === "gpt-6-luna");

  expect(luna?.adminOnly).toBe(true);
  expect(luna?.creditPerHour).toBe(CREDIT_PER_HOUR);

  // One model is operator-only; the rest are not.
  for (const model of MODELS) {
    if (model.id === "gpt-6-luna") continue;
    expect(model.adminOnly).not.toBe(true);
  }

  expect(modelRequiresAdmin("gpt-6-luna")).toBe(true);
  expect(modelRequiresAdmin("deepseek-flash")).toBe(false);
  expect(modelRequiresAdmin("not-a-model")).toBe(false);

  // A reader's picker does not contain it; an operator's does.
  expect(modelsForReader(MODELS, false).map((model) => model.id)).toEqual([
    "auto",
    "deepseek-flash",
    "claude-haiku",
  ]);
  expect(modelsForReader(MODELS, true).map((model) => model.id)).toContain(
    "gpt-6-luna"
  );

  expect(adminOnlyRefusal("gpt-6-luna", true)).toBeNull();
  expect(adminOnlyRefusal("deepseek-flash", false)).toBeNull();

  const refusal = adminOnlyRefusal("gpt-6-luna", false);
  expect(refusal?.code).toBe("admin-only");
  expect(refusal?.error).toContain("operator-only");
});

test("the server refuses the paid-only model before it charges the hour", () => {
  const route = readFileSync(
    new URL("../app/api/chat/route.ts", import.meta.url),
    "utf8"
  );

  // A gate that ran after the charge would still spend Credit on a refusal.
  const gate = route.indexOf("paidOnlyRefusal(");
  const charge = route.indexOf("startCreditSession(");

  expect(gate).toBeGreaterThan(-1);
  expect(charge).toBeGreaterThan(gate);
});

test("the database enforces the pass, not only the route", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/051_premium_models.sql", import.meta.url),
    "utf8"
  );

  expect(migration).toContain("when 'claude-haiku' then true");
  expect(migration).toContain("hour_sessions_enforce_pass");
  expect(migration).toContain("model requires a paid pass");
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
