import { expect, test } from "bun:test";

import { executionConfigured, sandboxTurnsEnabled } from "../lib/env";

/**
 * The activation contract for the E2B sandbox.
 *
 * Two switches decide whether a sandbox exists, and they answer different
 * questions: `executionConfigured()` is "can this deployment start a box at
 * all", `sandboxTurnsEnabled()` is "may a chat turn use one". Merging them, or
 * letting one absorb the other, is how the product ends up promising a shell it
 * will not provision. These cases pin the split.
 */

test("no key means no sandbox anywhere", () => {
  expect(executionConfigured({})).toBe(false);
  expect(executionConfigured({ E2B_API_KEY: "   " })).toBe(false);
  expect(executionConfigured({ OPENMI_SANDBOX_TURNS: "on" })).toBe(false);
});

test("a key enables sandboxes unless the kill switch is off", () => {
  expect(executionConfigured({ E2B_API_KEY: "k" })).toBe(true);
  expect(executionConfigured({ E2B_API_KEY: " k " })).toBe(true);

  for (const off of ["off", "false", "0", "OFF", " false "]) {
    expect(executionConfigured({ E2B_API_KEY: "k", EXECUTION_ENABLED: off })).toBe(false);
  }

  for (const on of ["on", "true", "1", ""]) {
    expect(executionConfigured({ E2B_API_KEY: "k", EXECUTION_ENABLED: on })).toBe(true);
  }
});

test("chat shell turns default to on, and an operator can still turn them off", () => {
  expect(sandboxTurnsEnabled({})).toBe(true);
  expect(sandboxTurnsEnabled({ E2B_API_KEY: "k" })).toBe(true);
  expect(sandboxTurnsEnabled({ OPENMI_SANDBOX_TURNS: "off" })).toBe(false);
});

test("chat shell turns accept the documented truthy spellings", () => {
  for (const on of ["on", "true", "1", "yes", "ON", " true "]) {
    expect(sandboxTurnsEnabled({ OPENMI_SANDBOX_TURNS: on })).toBe(true);
  }

  for (const off of ["off", "false", "0", "no"]) {
    expect(sandboxTurnsEnabled({ OPENMI_SANDBOX_TURNS: off })).toBe(false);
  }

  // A blank value is the default, not a switch.
  expect(sandboxTurnsEnabled({ OPENMI_SANDBOX_TURNS: "" })).toBe(true);
});

test("a chat turn needs both switches, and a mission needs only the key", () => {
  const keyOnly = { E2B_API_KEY: "k" };
  const both = { E2B_API_KEY: "k", OPENMI_SANDBOX_TURNS: "on" };
  const switchedOff = { E2B_API_KEY: "k", OPENMI_SANDBOX_TURNS: "off" };

  // The chat surface gate, as app/api/chat/route.ts composes it.
  const chatShell = (env: Record<string, string>) =>
    sandboxTurnsEnabled(env) && executionConfigured(env);

  expect(chatShell(keyOnly)).toBe(true);
  expect(chatShell(both)).toBe(true);
  expect(chatShell(switchedOff)).toBe(false);
  // The policy alone never conjures a box: no key, no sandbox.
  expect(chatShell({ OPENMI_SANDBOX_TURNS: "on" })).toBe(false);

  // Verification runs and missions read executionConfigured() alone.
  expect(executionConfigured(keyOnly)).toBe(true);
});
