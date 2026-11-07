import { expect, test } from "bun:test";

import { readFileSync } from "node:fs";

/**
 * Trash and purge are the paths where a database cascade and a provider disk
 * disagree. These assert the ordering that makes them agree: the environment
 * row is marked before the chat row is touched, and a failed provider delete
 * leaves the row behind for the sweep.
 */

const actions = readFileSync("app/chat/actions.ts", "utf8");
const destroy = readFileSync("lib/execution/chat-env/destroy.ts", "utf8");

function at(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle);
  expect(index).toBeGreaterThan(-1);
  return index;
}

function action(name: string, next: string): string {
  return actions.slice(at(actions, `export async function ${name}(`), at(actions, `export async function ${next}(`));
}

test("trash proves ownership before releasing the sandbox", () => {
  const trash = action("trashChat", "restoreChat");

  expect(at(trash, "deleted_at: new Date().toISOString()")).toBeLessThan(
    at(trash, '.select("id")')
  );
  expect(at(trash, '.select("id")')).toBeLessThan(at(trash, "trashChatSandbox(chatId)"));
  expect(trash).toContain('if (!trashed) fail("That chat no longer exists.")');
});

test("purge proves the row is owned and trashed before touching the environment", () => {
  const purge = action("purgeChat", "emptyTrash");

  expect(at(purge, '.select("id")')).toBeLessThan(at(purge, "wipeChatSandbox(chatId)"));
  expect(at(purge, "wipeChatSandbox(chatId)")).toBeLessThan(at(purge, '.delete()'));
  expect(purge).toContain('if (!trashed) fail("That chat is not in the trash.")');
});

test("empty trash deletes only the ids it wiped", () => {
  const empty = actions.slice(at(actions, "export async function emptyTrash("));

  expect(at(empty, '.select("id")')).toBeLessThan(at(empty, "wipeChatSandboxes("));
  expect(at(empty, "wipeChatSandboxes(")).toBeLessThan(at(empty, ".delete()"));
  expect(empty).toContain('.in("id", ids)');
});

test("a wipe marks the row wiping before asking the provider", () => {
  const wipe = destroy.slice(at(destroy, "export async function wipeChatSandbox("), at(destroy, "export async function wipeChatSandboxes("));

  expect(at(wipe, "markWiping")).toBeLessThan(at(wipe, "destroySandboxConfirmed"));
  expect(at(wipe, "destroySandboxConfirmed")).toBeLessThan(at(wipe, "deleteChatSandboxRow"));
});

test("trash never stops a box a live turn holds", () => {
  const trash = destroy.slice(at(destroy, "export async function trashChatSandbox("), at(destroy, "export async function wipeChatSandbox("));

  expect(at(trash, "isLeaseLive")).toBeLessThan(at(trash, "handle.stop("));
  expect(trash).toContain("markWiping(admin, row, now)");
  expect(destroy).toContain("delete_after: new Date(now).toISOString()");
});

test("teardown failures never fail the action", () => {
  // Both hooks catch the provider call; the row stays for the sweep.
  expect(destroy).toContain("Kept for the sweep");
  expect(destroy).toContain("wipeChatSandboxes");
  expect(actions).not.toContain("await wipeChatSandbox(chatId).catch");
});
