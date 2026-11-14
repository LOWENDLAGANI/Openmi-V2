import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { splitRetryNotice } from "../lib/rate-limit";

/**
 * A refusal that says "try again in 58 seconds" and then sits there for a
 * minute is a number the reader learns to ignore. The sentence is split once,
 * in the shared module, and the component ticks the seconds down — so the copy
 * the routes produce and the clock on screen cannot disagree.
 */

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const NOTICE = read("/components/RetryNotice.tsx");
const CHAT_PANEL = read("/components/ChatPanel.tsx");

test("a rate-limit sentence keeps its reason and yields the wait", () => {
  expect(splitRetryNotice("Too many messages. Try again in 58 seconds.")).toEqual({
    text: "Too many messages.",
    seconds: 58,
  });

  expect(splitRetryNotice("Too many approvals. Try again in 1 seconds.")).toEqual({
    text: "Too many approvals.",
    seconds: 1,
  });
});

test("an ordinary error is printed unchanged", () => {
  const message = "The file could not be saved.";

  expect(splitRetryNotice(message)).toEqual({ text: message, seconds: null });
});

test("a zero or malformed wait is not a countdown", () => {
  expect(splitRetryNotice("Too many messages. Try again in 0 seconds.").seconds).toBe(
    null
  );
  expect(splitRetryNotice("Too many messages. Try again soon.").seconds).toBe(null);
});

test("the notice ticks the wait and the chat error uses it", () => {
  expect(NOTICE).toContain("setInterval");
  expect(NOTICE).toContain("tabular-nums");
  expect(CHAT_PANEL).toContain("<RetryNotice message={error} />");
});
