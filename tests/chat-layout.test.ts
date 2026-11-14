import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const CSS = read("/app/globals.css");
const PANEL = read("/components/ChatPanel.tsx");
const BODY = read("/components/MessageBody.tsx");

/**
 * A long prompt is the normal case, and one unbroken token used to set the
 * width of the whole column. These assertions pin the wrapping rules so a
 * restyle cannot quietly bring the bend back.
 */

test("user text and answers break inside a long token, not out of the box", () => {
  const bubble = CSS.slice(CSS.indexOf(".msg-user-bubble"));
  expect(bubble.slice(0, 600)).toContain("overflow-wrap: anywhere");
  expect(bubble.slice(0, 600)).toContain("min-width: 0");

  const prose = CSS.slice(CSS.indexOf(".prose-chat {"));
  expect(prose.slice(0, 200)).toContain("overflow-wrap: anywhere");

  // The transcript scrolls vertically only: a wide child must never turn the
  // panel into a horizontal scroller.
  expect(PANEL).toContain("overflow-x-hidden overflow-y-auto");

  // The flex rows that hold a message can shrink, so the bubble's max-width is
  // what decides the width rather than the widest word inside it.
  expect(PANEL).toContain('className="flex min-w-0 flex-col items-end gap-1"');
  expect(PANEL).toContain("group min-w-0 max-w-[94%]");
  expect(PANEL).toContain("min-w-0 max-w-[94%]");

  // Reasoning and terminal output carry the longest unbroken paths.
  expect(PANEL).toContain("[overflow-wrap:anywhere]");
  expect(BODY).toContain("max-w-full overflow-x-auto");
});

test("a reader who scrolled away is offered the way back", () => {
  expect(PANEL).toContain("function jumpToLatest(");
  expect(PANEL).toContain("onClick={jumpToLatest}");
  // The pill names the live turn, and says nothing when none is running.
  expect(PANEL).toContain('streaming ? "new output ↓" : "jump to end ↓"');
  expect(PANEL).toContain("!atBottom && (");
});

test("a streaming answer looks like it is still arriving", () => {
  expect(PANEL).toContain('className="stream-caret"');
  expect(PANEL).toContain("streaming && pending.length > 0");
  expect(CSS).toContain(".stream-caret {");
  expect(CSS).toContain("@keyframes stream-caret-blink");
});

test("the composer warns before the server has to refuse the message", () => {
  const LIMITS = read("/lib/chat-limits.ts");
  const ROUTE = read("/app/api/chat/route.ts");

  // One number, used by both sides: a warning that disagreed with the refusal
  // would read as a broken send button.
  expect(LIMITS).toContain("export const MAX_MESSAGE_CHARS = 20_000");
  expect(ROUTE).toContain('from "@/lib/chat-limits"');
  expect(ROUTE).not.toContain("const MAX_MESSAGE_CHARS = 20_000");

  // The field lives in <Composer>, so that is where the limit has to appear.
  const COMPOSER = read("/components/Composer.tsx");
  expect(COMPOSER).toContain('from "@/lib/chat-limits"');
  expect(COMPOSER).toContain("text.length > MESSAGE_WARN_CHARS");
  expect(COMPOSER).toContain("text-danger");
});
