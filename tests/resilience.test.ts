import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { soft } from "../lib/soft";

/**
 * The chat page reads the transcript the reader came for and half a dozen
 * auxiliary things beside it. Those used to share one `Promise.all`, so a
 * missing GitHub token or a failed operator check replaced the conversation
 * with an error screen. Each auxiliary read now names what "missing" looks
 * like, and these assertions keep that true.
 */

const PAGE = readFileSync(
  new URL("../app/chat/page.tsx", import.meta.url),
  "utf8"
);

test("a rejected auxiliary read resolves to its fallback", async () => {
  expect(await soft(Promise.reject(new Error("auth down")), "forbidden")).toBe(
    "forbidden"
  );
  expect(await soft(Promise.resolve<string[]>([]), [])).toEqual([]);
  expect(await soft(Promise.resolve(7), 0)).toBe(7);
});

test("no auxiliary read on the chat page can reject its batch", () => {
  // The citation index: an unreadable tree leaves citations as plain text.
  expect(PAGE).toContain("soft(readCitationPaths(");
  // The operator check: a failure is "not an operator", never an error page.
  expect(PAGE).toContain("soft(readAdminAccess(session)");
  // The GitHub connection: a failure is the connect panel, not a blank chat.
  expect(PAGE).toContain("soft(readConnection(");
});

test("the transcript itself is read as itself", () => {
  // The one read that decides whether the page has content is not softened:
  // an empty transcript and a failed read must not look the same.
  expect(PAGE).toContain("listMessages(session.supabase, chat.id)");
  expect(PAGE).not.toContain("soft(listMessages(");
});

test("a woken worker cannot claim a run with a half-written transcript", () => {
  const ROUTE = readFileSync(
    new URL("../app/api/chat/route.ts", import.meta.url),
    "utf8"
  );

  // The history lands before the ping: the ping is what lets a sleeping worker
  // pick the run up, so sending it first races the transcript it needs.
  const written = ROUTE.indexOf("await appendRunMessages(");
  const woken = ROUTE.indexOf("wakeWorker();");

  expect(written).toBeGreaterThan(-1);
  expect(woken).toBeGreaterThan(written);
});

test("a draft uses the page's session instead of resolving its own", () => {
  const start = PAGE.indexOf("async function DraftChat");
  const end = PAGE.indexOf("async function ChatPage", start);
  const draft = PAGE.slice(start, end === -1 ? undefined : end);

  expect(start).toBeGreaterThan(-1);
  expect(draft).not.toContain("getSession(");
  expect(draft).toContain("readAdminAccess(session)");
});

test("the credit refill cannot throw the page away", () => {
  // `refillDailyCredit` returns null on failure and the chip falls back to the
  // stored balance, so a refill failure never fails the render.
  expect(PAGE).toContain("refilledBalance ??");
  expect(PAGE).toContain("refillDailyCredit(supabase)");
});
