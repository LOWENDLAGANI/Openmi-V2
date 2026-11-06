import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  EmptyCompletionError,
  ProviderError,
  assertAnswer,
  readDelta,
} from "../lib/provider-stream";

/**
 * The bug these pin: every DeepSeek answer looked like "the provider returned an
 * empty answer".
 *
 * DeepSeek's V4.1 flash has thinking mode on by default at high effort, and its
 * chain of thought streams in `reasoning_content` while the answer streams in
 * `content`. The parser read `content` only, so a thinking model produced
 * nothing at all — and with a 2,000-token reply budget, the reasoning could
 * finish the budget before the answer began.
 */

const frame = (delta: unknown, finish: unknown = null) =>
  JSON.stringify({ choices: [{ delta, finish_reason: finish }] });

test("an answer frame is the content delta", () => {
  expect(readDelta(frame({ content: "hello" }))).toEqual({ content: "hello" });
});

test("a thinking frame is read as reasoning, never as an answer", () => {
  const reasoning = readDelta(frame({ reasoning_content: "the user wants X" }));

  expect(reasoning).toEqual({ reasoning: "the user wants X" });
  expect(reasoning?.content).toBeUndefined();

  // Some OpenAI-compatible servers spell the same field without the suffix.
  expect(readDelta(frame({ reasoning: "thinking" }))?.reasoning).toBe("thinking");
});

test("a thinking frame that also carries content keeps both", () => {
  expect(
    readDelta(frame({ reasoning_content: "checking", content: "done" }))
  ).toEqual({ reasoning: "checking", content: "done" });
});

test("a tool-call frame keeps its index, id, name and arguments", () => {
  const parsed = readDelta(
    frame({
      content: "",
      tool_calls: [
        {
          index: 0,
          id: "call_1",
          function: { name: "read_file", arguments: '{"path":"a.ts"}' },
        },
      ],
    })
  );

  expect(parsed?.toolCalls).toEqual([
    {
      index: 0,
      id: "call_1",
      name: "read_file",
      arguments: '{"path":"a.ts"}',
    },
  ]);
  // An empty content delta is not text; the tool call is the step.
  expect(parsed?.content).toBeUndefined();
});

test("finish_reason is carried so an empty reply can explain itself", () => {
  expect(readDelta(frame({}, "length"))?.finishReason).toBe("length");
  expect(readDelta(frame({ content: "x" }, "stop"))?.finishReason).toBe("stop");
});

test("keepalives and unreadable frames are skipped, not invented", () => {
  expect(readDelta("not json")).toBeNull();
  expect(readDelta(JSON.stringify({ choices: [] }))).toBeNull();
  expect(readDelta(JSON.stringify({ type: "keepalive" }))).toBeNull();
});

test("a turn that only called a tool is complete, not empty", () => {
  expect(() =>
    assertAnswer({ sawAnswer: true, sawReasoning: true, finishReason: null })
  ).not.toThrow();
});

test("a reasoning-only stream names the reason instead of saying 'empty'", () => {
  try {
    assertAnswer({ sawAnswer: false, sawReasoning: true, finishReason: null });
    throw new Error("expected a refusal");
  } catch (caught) {
    expect(caught).toBeInstanceOf(EmptyCompletionError);
    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as Error).message).toContain("reasoning");
    expect((caught as Error).message).not.toContain("empty answer");
  }
});

test("hitting the reply limit and sending nothing are different sentences", () => {
  const limit = (() => {
    try {
      assertAnswer({ sawAnswer: false, sawReasoning: false, finishReason: "length" });
    } catch (caught) {
      return (caught as Error).message;
    }
    return "";
  })();

  const silent = (() => {
    try {
      assertAnswer({ sawAnswer: false, sawReasoning: false, finishReason: "stop" });
    } catch (caught) {
      return (caught as Error).message;
    }
    return "";
  })();

  expect(limit).toContain("reply tokens");
  expect(silent).toContain("without sending any text");
  expect(limit).not.toBe(silent);
});

test("both request paths turn thinking off for the provider that defaults it on", () => {
  const source = readFileSync(
    new URL("../lib/providers.ts", import.meta.url),
    "utf8"
  );

  const stream = readFileSync(
    new URL("../lib/provider-stream.ts", import.meta.url),
    "utf8"
  );

  // The vendor knows it reasons by default; the request turns it off.
  expect(source).toContain("thinksByDefault: true");
  expect(stream).toContain('thinking: { type: "disabled" }');

  // The text path and the tool path must not drift: one spread each.
  expect(source.split("...thinkingOption(provider),").length - 1).toBe(2);

  // An empty completion is not retried on the next key, which would only spend
  // a second key on the same refusal.
  expect(source.split("caught instanceof EmptyCompletionError").length - 1).toBe(2);
});
