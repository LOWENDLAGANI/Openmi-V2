import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { RATE_LIMITS } from "../lib/rate-limit";

/**
 * The two routes that spend something other than a request.
 *
 * A preview start leaves a dev server running in a sandbox, and a publish queues
 * a deployment with the operator's hosting token. Neither is a loop a reader
 * should be able to write in a browser console.
 */

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("preview and publish have their own named ceilings", () => {
  for (const kind of ["preview", "publish"] as const) {
    expect(RATE_LIMITS[kind].max).toBeGreaterThan(0);
    expect(Number.isInteger(RATE_LIMITS[kind].max)).toBe(true);
    expect(RATE_LIMITS[kind].windowMs).toBe(60_000);
  }

  // A start is heavier than a message and lighter than a deployment.
  expect(RATE_LIMITS.preview.max).toBeLessThanOrEqual(RATE_LIMITS.chat.max);
  expect(RATE_LIMITS.publish.max).toBeLessThanOrEqual(RATE_LIMITS.preview.max);
});

test("a preview start is counted before the dev server starts", () => {
  const route = source("../app/api/preview/[chatId]/route.ts");

  expect(route).toContain('checkRateLimit(admin, "preview", session.user.id)');
  expect(route).toContain("status: 429");
  expect(route).toContain('"retry-after": String(limited.retryAfterSeconds)');

  // The limit is read before the call that starts anything.
  expect(route.indexOf('checkRateLimit(admin, "preview"')).toBeLessThan(
    route.indexOf("await startChatPreview(")
  );
});

test("a publish is counted before a deployment is queued", () => {
  const route = source("../app/api/publish/[chatId]/route.ts");

  expect(route).toContain('checkRateLimit(admin, "publish", session.user.id)');
  expect(route).toContain("status: 429");
  expect(route.indexOf('checkRateLimit(admin, "publish"')).toBeLessThan(
    route.indexOf("await publishChat(")
  );
});
