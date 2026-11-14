import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { CHAT_TITLE_MAX, titleFromMessage } from "../lib/chat-title";

/**
 * A sidebar of rows all called "New chat" is a list with no names. The title is
 * derived once, on the server, from the message that created the chat — these
 * assertions keep that rule small and keep the insert from drifting back to a
 * placeholder.
 */

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const ROUTE = read("/app/api/chat/route.ts");
const ACTIONS = read("/app/chat/actions.ts");

test("a chat is named by its first message", () => {
  expect(titleFromMessage("Fix the login redirect\nit lands on /about")).toBe(
    "Fix the login redirect it lands on /about"
  );
  expect(titleFromMessage("   ")).toBe("New chat");
});

test("a long first line is cut on a word boundary, not mid-word", () => {
  const title = titleFromMessage(
    "Explain how the rate limiter decides between Upstash and Postgres, and why it fails open"
  );

  expect(title.length).toBeLessThanOrEqual(CHAT_TITLE_MAX + 1);
  expect(title.endsWith("…")).toBe(true);
  expect(title).not.toContain("  ");
  expect(title.slice(0, -1).endsWith(" ")).toBe(false);
});

test("a single long token is cut where the cap falls", () => {
  const title = titleFromMessage("a".repeat(CHAT_TITLE_MAX * 2));

  expect(title.endsWith("…")).toBe(true);
  expect(title.length).toBeLessThanOrEqual(CHAT_TITLE_MAX + 1);
});

test("the chat row is created with the message's title", () => {
  expect(ROUTE).toContain("title: titleFromMessage(content)");
  expect(ROUTE).not.toContain('title: "New chat"');
});

test("a chat can be renamed by its owner, without leaving the chat", () => {
  expect(ACTIONS).toContain("export async function renameChat");
  expect(ACTIONS).toContain("update({ title })");
  expect(ACTIONS).toContain('.eq("owner", user.id)');

  const body = ACTIONS.slice(ACTIONS.indexOf("export async function renameChat"));
  expect(body.slice(0, body.indexOf("export async function trashChat"))).not.toContain(
    'redirect("/chat")'
  );
});
