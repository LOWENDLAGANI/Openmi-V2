import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Perceived speed is a structural property, not a copy change.
 *
 * Next.js' interactive-app guidance and web.dev's Core Web Vitals advice agree
 * on the order: paint the shell first, stream the slow reads into a boundary,
 * reserve the space their content will take, and start independent work before
 * the first await. These assertions keep the chat page from drifting back to a
 * render that waits for GitHub before drawing the sidebar.
 */

const read = (path: string) =>
  readFileSync(new URL(`..${path}`, import.meta.url), "utf8");

const PAGE = read("/app/chat/page.tsx");
const SKELETON = read("/components/ChatSkeleton.tsx");
const LOADING = read("/app/chat/loading.tsx");

test("the shell paints before the conversation's data", () => {
  // The conversation is streamed into its own boundary, so the sidebar, header
  // and account bar are not held hostage by a GitHub round trip.
  expect(PAGE).toContain("<Suspense fallback={<ChatSkeleton />}>");
  expect(PAGE).toContain("<ChatView session={session} chat={activeChat} />");
  expect(PAGE).not.toContain("await ChatView(");
  expect(PAGE).not.toContain("await RepoSurface(");
});

test("independent reads start before the first await", () => {
  // The citation index used to run after the Supabase reads, adding its whole
  // latency to the transcript.
  const start = PAGE.indexOf("const citationPaths =");
  const batch = PAGE.indexOf("await Promise.all([", start);

  expect(start).toBeGreaterThan(-1);
  expect(batch).toBeGreaterThan(start);
  expect(PAGE).toContain("readCitationPaths(session, chat.repo_full_name");
  expect(PAGE).toContain("    citationPaths,");
});

test("the skeleton reserves the composer's height", () => {
  // A skeleton that changes size on arrival is a layout shift with extra steps.
  expect(SKELETON).toContain('aria-busy="true"');
  expect(SKELETON).toContain("mt-auto h-28");
  expect(SKELETON).toContain("skeleton");
});

test("the route skeleton and the in-page boundary share one shape", () => {
  expect(LOADING).toContain("<ChatSkeleton />");
});

test("a clicked chat row answers before the server does", () => {
  const LIST = read("/components/ChatList.tsx");

  // The highlight used to wait for the server render, which is long enough for
  // a reader to conclude the click was ignored and press again.
  expect(LIST).toContain("onOpen(chat.id)");
  expect(LIST).toContain("chat.id === activeChatId || chat.id === opening");
  expect(LIST).toContain("10_000");
});
