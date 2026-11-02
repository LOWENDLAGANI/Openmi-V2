import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Vercel specifics are invisible in a local `next dev`: a cached response or a
 * buffered stream looks fine until it is deployed. These assertions are cheap
 * and they fail loudly when a header or a duration is dropped.
 */

const CHAT = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);
const STATUS = readFileSync(
  new URL("../app/api/github/status/route.ts", import.meta.url),
  "utf8"
);
const SETUP = readFileSync(new URL("../app/setup/page.tsx", import.meta.url), "utf8");
const ABOUT = readFileSync(new URL("../app/about/page.tsx", import.meta.url), "utf8");
const WORKSPACE = readFileSync(new URL("../app/chat/page.tsx", import.meta.url), "utf8");

test("the chat route is dynamic, bounded and unbuffered", () => {
  expect(CHAT).toContain('export const runtime = "nodejs"');
  expect(CHAT).toContain('export const dynamic = "force-dynamic"');
  expect(CHAT).toContain("export const maxDuration = 60");
  expect(CHAT).toContain('"cache-control": "no-store');
  expect(CHAT).toContain('"x-accel-buffering": "no"');
  expect(CHAT).toContain('"content-type": "text/event-stream; charset=utf-8"');
});

test("no route or page that reads configuration is cacheable", () => {
  expect(STATUS).toContain('"cache-control": "no-store"');
  expect(SETUP).toContain('export const dynamic = "force-dynamic"');
  expect(WORKSPACE).toContain('export const dynamic = "force-dynamic"');
  expect(ABOUT).not.toContain("force-dynamic");
});

test("the rate limit is checked before the provider and carries Retry-After", () => {
  const limitAt = CHAT.indexOf('checkRateLimit(supabaseAdmin(), "chat"');
  const chargeAt = CHAT.indexOf("await startDewSession(");

  expect(limitAt).toBeGreaterThan(-1);
  expect(CHAT).toContain('"retry-after"');
  expect(limitAt).toBeLessThan(chargeAt);
});
