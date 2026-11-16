import { expect, test } from "bun:test";

import { interleaveAnswer } from "../lib/chat/interleave";
import type { AgentStep } from "../lib/types";

const step = (detail: string, at?: number): AgentStep => ({
  tool: "run_command",
  detail,
  state: "done",
  at,
});

test("an answer with no steps is one segment", () => {
  expect(interleaveAnswer("Just this.", null)).toEqual([
    { text: "Just this.", steps: [] },
  ]);
});

test("a step recorded before any text sits above the answer", () => {
  const segments = interleaveAnswer("The answer.", [step("Read the file", 0)]);

  expect(segments.map((segment) => segment.text)).toEqual(["", "The answer."]);
  expect(segments[0].steps.map((entry) => entry.detail)).toEqual([
    "Read the file",
  ]);
});

test("a step is cut in at the paragraph that was on screen when it ran", () => {
  const content = "I'll check the config.\n\nIt was the port.";
  const breakAt = content.indexOf("\n\n") + 2;

  // The offset is inside the second paragraph on purpose: the cut snaps back to
  // the break, so a sentence is never split across a console.
  const segments = interleaveAnswer(content, [
    step("Read config.ts", breakAt + 4),
  ]);

  expect(segments.map((segment) => segment.text)).toEqual([
    content.slice(0, breakAt),
    content.slice(breakAt),
  ]);
  expect(segments[0].steps).toHaveLength(1);
  expect(segments[1].steps).toHaveLength(0);
});

test("a paragraph with no break keeps its step on top instead of splitting it", () => {
  const segments = interleaveAnswer("One paragraph only.", [
    step("List the files", 5),
  ]);

  expect(segments.map((segment) => segment.text)).toEqual([
    "",
    "One paragraph only.",
  ]);
});

test("a fenced code block is never cut in two", () => {
  const content =
    "Before.\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter.";
  const fenceStart = content.indexOf("```");

  // The step lands between the two statements, which is the one place inside
  // this document where a careless cut would break the fence.
  const segments = interleaveAnswer(content, [
    step("Wrote the file", content.indexOf("const b")),
  ]);

  expect(segments[0].text).toBe(content.slice(0, fenceStart));
  expect(segments[1].text).toBe(content.slice(fenceStart));
  expect(segments[1].text).toContain("const b = 2;");
});

test("steps keep the order they ran in, even with a stale offset", () => {
  const content = "First.\n\nSecond.\n\nThird.";
  const segments = interleaveAnswer(content, [
    step("Ran the tests", content.length),
    step("Read the log", 2),
  ]);

  expect(segments.flatMap((segment) => segment.steps.map((entry) => entry.detail))).toEqual([
    "Ran the tests",
    "Read the log",
  ]);
  // A step behind the one before it joins that group rather than moving back.
  expect(segments[0].steps).toHaveLength(2);
  expect(segments.map((segment) => segment.text).join("")).toBe(content);
});

test("a step with no recorded place is treated as having happened first", () => {
  const segments = interleaveAnswer("A.\n\nB.", [step("No offset")]);

  expect(segments[0].text).toBe("");
  expect(segments[0].steps).toHaveLength(1);
});

test("the segments always reconstruct the answer", () => {
  const content = "One.\n\nTwo.\n\nThree.\n\nFour.";
  const segments = interleaveAnswer(content, [
    step("a", 3),
    step("b", 9),
    step("c", content.length),
  ]);

  expect(segments.map((segment) => segment.text).join("")).toBe(content);
});
