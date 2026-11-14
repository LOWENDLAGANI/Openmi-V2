import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Picking a repository and then pressing "New chat" used to drop the repo: the
 * draft had no chat row, the first message created one with no pin, and the
 * answer said "no repository attached". These assertions pin the three places
 * that have to agree for it to keep working.
 */

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const ROUTE = read("/app/api/chat/route.ts");
const PANEL = read("/components/ChatPanel.tsx");
const PAGE = read("/app/chat/page.tsx");
const SIDEBAR = read("/components/Sidebar.tsx");

test("a draft chat forwards its repository with the first message", () => {
  expect(PANEL).toContain("repo: repo?.fullName");
  expect(PANEL).toContain("branch: repo?.branch");
  expect(PANEL).toContain("sha: repo?.sha");
});

test("new chats inherit the repository the reader is looking at", () => {
  expect(PAGE).toContain("const draftRepo");
  expect(PAGE).toContain("const currentRepo");
  expect(PAGE).toContain("<DraftChat repo={draftRepo} />");
  expect(PAGE).toContain("repo={currentRepo}");
  expect(SIDEBAR).toContain("const newChatHref");
  expect(SIDEBAR).toContain("href={newChatHref}");
});

test("the chat row is created with a server-resolved pin", () => {
  expect(ROUTE).toContain('typeof body.repo === "string" && isRepoFullName');
  expect(ROUTE).toContain("repo_full_name: requestedRepo");
  expect(ROUTE).toContain("repo_branch: requestedBranch");
  expect(ROUTE).toContain("repo_base_sha: requestedSha");
  expect(ROUTE).toContain("resolveBranchSha");
  // Still created on the first message, not when the button is pressed.
  expect(ROUTE).toContain("title: titleFromMessage(content)");
});
