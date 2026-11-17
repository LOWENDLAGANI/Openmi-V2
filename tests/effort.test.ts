import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  DEFAULT_REASONING_EFFORT,
  EFFORT_MODELS,
  REASONING_EFFORTS,
  effortOrDefault,
  isReasoningEffort,
  modelSupportsEffort,
  reasoningRequest,
} from "../lib/models/effort";

/**
 * What these pin: the three efforts a reader can pick, which model is offered
 * them, and the exact fields each level sends.
 *
 * The failure they exist against is a control that looks like it works: a level
 * the provider does not accept, a model sent a field its vendor never defined,
 * or an effort that never reaches the request at all.
 */

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

test("three efforts, in order, with the provider's own default", () => {
  expect(REASONING_EFFORTS.map((effort) => effort.id)).toEqual([
    "fast",
    "high",
    "max",
  ]);
  expect(REASONING_EFFORTS.map((effort) => effort.label)).toEqual([
    "Fast",
    "High",
    "Max",
  ]);

  // DeepSeek's documented default is high; inventing a different one would make
  // the control change behaviour for a reader who never touched it.
  expect(DEFAULT_REASONING_EFFORT).toBe("high");

  for (const effort of REASONING_EFFORTS) {
    expect(effort.blurb.length).toBeGreaterThan(10);
  }
});

test("an unrecognised level falls back instead of being forwarded", () => {
  expect(isReasoningEffort("max")).toBe(true);
  expect(isReasoningEffort("medium")).toBe(false);
  expect(isReasoningEffort("")).toBe(false);
  expect(isReasoningEffort(undefined)).toBe(false);
  expect(isReasoningEffort(3)).toBe(false);

  // A level the provider would reject must never reach it.
  expect(effortOrDefault("ultra")).toBe("high");
  expect(effortOrDefault(null)).toBe("high");
  expect(effortOrDefault("fast")).toBe("fast");
});

test("only the model whose vendor documents an effort offers it", () => {
  expect(EFFORT_MODELS).toEqual(["deepseek-flash"]);
  expect(modelSupportsEffort("deepseek-flash")).toBe(true);

  for (const other of ["auto", "claude-haiku", "gpt-oss", "gpt-6-luna", "custom"]) {
    expect(modelSupportsEffort(other)).toBe(false);
  }
});

test("fast turns thinking off; high and max name the level", () => {
  // One documented field does both jobs: `none` is the off switch.
  expect(reasoningRequest("fast")).toEqual({ reasoning_effort: "none" });
  expect(reasoningRequest("high")).toEqual({ reasoning_effort: "high" });
  expect(reasoningRequest("max")).toEqual({ reasoning_effort: "max" });

  // The vendor-private `thinking` object is not sent: a proxy that validates an
  // OpenAI-compatible body may reject a field it does not define.
  for (const effort of REASONING_EFFORTS) {
    expect(reasoningRequest(effort.id).thinking).toBeUndefined();
  }
});

test("the effort reaches the provider, and only the vendors that define it", () => {
  const providers = read("/lib/providers.ts");

  // The request is built with the level, on the tool path the chat uses.
  expect(providers).toContain("reasoningRequest(effort)");
  expect(providers).toContain("provider.supportsEffort && effort");

  // Exactly the two DeepSeek-family routes carry the capability: Straitly first,
  // then the direct provider. A vendor handed a field it does not define is a
  // 400, and a 400 is a failed turn.
  expect(providers.split("supportsEffort: true").length - 1).toBe(2);
});

test("the choice travels from the composer to the run row and back", () => {
  const panel = read("/components/ChatPanel.tsx");
  const route = read("/app/api/chat/route.ts");
  const store = read("/lib/runs/store.ts");
  const loop = read("/lib/runs/loop.ts");
  const composer = read("/components/Composer.tsx");

  // The panel sends what the control holds.
  expect(panel).toContain("effort={effort}");
  expect(panel).toContain("onEffortChange={setEffort}");
  expect(panel).toContain("effort,");

  // The route decides it for the model that takes one and records it.
  expect(route).toContain("modelSupportsEffort(model)");
  expect(route).toContain("effortOrDefault(body.effort)");
  expect(route).toContain("createRun(admin");

  // The store keeps the column, and the worker reads it before its first call.
  expect(store).toContain("effort: ReasoningEffort | null");
  expect(store).toContain("effort: input.effort ?? null");
  expect(store).toContain(", effort,");
  expect(loop).toContain("effortOrDefault(run.effort)");
  expect(loop).toContain("effort,");

  // The control only appears where it does something.
  expect(composer).toContain("modelSupportsEffort(model)");
  expect(composer).toContain("<EffortMenu");
});

test("the database records the effort and refuses anything else", () => {
  const migration = read("/supabase/migrations/056_run_effort.sql");

  expect(migration).toContain("add column if not exists effort");
  expect(migration).toContain(
    "check (effort is null or effort in ('fast', 'high', 'max'))"
  );

  // Nullable on purpose: a null effort is the provider's default, not a guess.
  expect(migration).toContain("effort is null or");

  // Applying twice must be a no-op, so the constraint is added under a guard.
  expect(migration).toContain("if not exists (");
  expect(migration).toContain("runs_effort_allowed");
});
