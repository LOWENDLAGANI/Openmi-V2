import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const MOTION = readFileSync(
  new URL("../components/Motion.tsx", import.meta.url),
  "utf8"
);
const PANEL = readFileSync(
  new URL("../components/ChatPanel.tsx", import.meta.url),
  "utf8"
);

const PACKAGE = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { dependencies?: Record<string, string> };

test("the motion layer is gsap, declared, and honours reduced motion", () => {
  expect(PACKAGE.dependencies?.gsap).toBeTruthy();
  expect(MOTION).toContain("prefers-reduced-motion");
  expect(MOTION).toContain("ScrollToPlugin");
  expect(PANEL).toContain("scrollToBottom(");
});

test("streaming jumps to the end instead of tweening per token", () => {
  expect(PANEL).toContain("scrollToBottom(element, pending.length > 0)");
  expect(MOTION).toContain("if (instant || reduced)");
});

test("transcript arrivals are animated once, not on every render", () => {
  expect(PANEL).toContain("function EnteringArticle(");
  expect(PANEL).toContain("useEnter<HTMLElement>()");
  expect(PANEL).not.toContain('className="rise-in flex flex-col items-end gap-1"');
});
