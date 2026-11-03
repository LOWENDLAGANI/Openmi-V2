import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

/**
 * Loading is easy to regress: a skeleton that drifts from the real shell, or a
 * spinner that only one page uses, is invisible in a unit test but obvious on a
 * slow connection. These assertions pin the shared vocabulary.
 */

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const LOADING = read("/components/Loading.tsx");
const THINKING = read("/components/AiThinking.tsx");
const SKELETON = read("/components/PageSkeleton.tsx");
const CHAT_PANEL = read("/components/ChatPanel.tsx");
const CSS = read("/app/globals.css");

test("the spinner is the brand mark, driven by one CSS animation", () => {
  expect(LOADING).toContain("export function Spinner");
  expect(LOADING).toContain("className={`spinner");
  expect(LOADING).toContain("M4 15 12 7l8 8");

  expect(CSS).toContain("@keyframes spin-slow");
  expect(CSS).toContain(".spinner {");
  expect(CSS).toContain("@keyframes shimmer");
  expect(CSS).toContain(".skeleton::after");
});

test("the AI wait shows a spinner and a truthful label", () => {
  expect(CHAT_PANEL).toContain("<AiThinking");
  expect(CHAT_PANEL).not.toContain("computing…");

  expect(THINKING).toContain("ThinkingPill");
  expect(THINKING).toContain("still working on the server");
  // A pipeline detail outranks decorative copy.
  expect(THINKING).toContain("stepLabel.length > 0");
  // The copy must not claim verification that did not happen.
  expect(THINKING).not.toMatch(/test(s)? (passed|ran)/i);
});

test("every route that waits has a branded loading state", () => {
  for (const path of [
    "/app/loading.tsx",
    "/app/chat/loading.tsx",
    "/app/setup/loading.tsx",
    "/app/activity/loading.tsx",
    "/app/pay/loading.tsx",
    "/app/admin/loading.tsx",
    "/app/about/loading.tsx",
  ]) {
    expect(existsSync(new URL(`..${path}`, import.meta.url))).toBe(true);
  }

  expect(SKELETON).toContain("Spinner");
  expect(SKELETON).toContain("skeleton");
});
