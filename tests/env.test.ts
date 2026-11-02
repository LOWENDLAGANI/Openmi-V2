import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ENV_SPEC, readEnvReport } from "../lib/env";

const EXAMPLE = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

const DOCUMENTED = EXAMPLE.split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"))
  .map((line) => line.split("=")[0]?.trim() ?? "");

test("every key the app reads is documented in .env.example", () => {
  const specKeys = ENV_SPEC.map((spec) => spec.key);
  const undocumented = specKeys.filter((key) => !DOCUMENTED.includes(key));

  expect(undocumented).toEqual([]);
});

test(".env.example documents no key the app does not read", () => {
  const specKeys = ENV_SPEC.map((spec) => spec.key);
  const extra = DOCUMENTED.filter((key) => !specKeys.includes(key));

  expect(extra).toEqual([]);
});

test("missing configuration is reported, never thrown", () => {
  const report = readEnvReport({});

  expect(report.ready).toBe(false);
  expect(report.requiredPresent).toBe(0);
  expect(report.missingRequired).toContain("NEXT_PUBLIC_SUPABASE_URL");
  expect(report.missingRequired).toContain("GITHUB_TOKEN_KEY");
  expect(
    report.missingRequired.some((entry) => entry.startsWith("AI provider"))
  ).toBe(true);
});

test("a complete configuration is ready with one provider key", () => {
  const env: Record<string, string> = Object.fromEntries(
    ENV_SPEC.filter((spec) => spec.required).map((spec) => [spec.key, "set"])
  );
  env.OPENROUTER_API_KEY = "set";

  const report = readEnvReport(env);

  expect(report.missingRequired).toEqual([]);
  expect(report.aiProviders).toBe(1);
  expect(report.ready).toBe(true);
});

test("no server-scope key is exposed to the browser", () => {
  const leaked = ENV_SPEC.filter(
    (spec) => spec.scope === "server" && spec.key.startsWith("NEXT_PUBLIC_")
  );

  expect(leaked).toEqual([]);
});
