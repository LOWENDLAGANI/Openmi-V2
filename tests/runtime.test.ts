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
  // The chat route now hosts a sandbox on demand, so it asks for the same
  // ceiling the verification and mission routes already use.
  expect(CHAT).toContain("export const maxDuration = 300");
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

test("the chat row is created only after the message and provider are valid", () => {
  const content = CHAT.indexOf("Write something first.");
  const provider = CHAT.indexOf("if (!providersConfigured())");
  const create = CHAT.indexOf('.from("chats")');

  expect(content).toBeGreaterThan(-1);
  expect(provider).toBeGreaterThan(-1);
  expect(create).toBeGreaterThan(-1);
  expect(content).toBeLessThan(create);
  expect(provider).toBeLessThan(create);
});

const MUTATING_ROUTES = [
  "../app/api/chat/route.ts",
  "../app/api/chat/stop/route.ts",
  "../app/api/dew/end-session/route.ts",
  "../app/api/execution/runs/route.ts",
  "../app/api/execution/runs/[id]/route.ts",
  "../app/api/missions/route.ts",
  "../app/api/missions/[id]/route.ts",
  "../app/api/missions/[id]/tick/route.ts",
];

test("every mutating route rejects a foreign origin", () => {
  for (const route of MUTATING_ROUTES) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    expect(source).toContain("isSameOrigin(request)");
  }
});

test("the rate limit is checked before the provider and carries Retry-After", () => {
  const limitAt = CHAT.indexOf('checkRateLimit(supabaseAdmin(), "chat"');
  const chargeAt = CHAT.indexOf("await startDewSession(");

  expect(limitAt).toBeGreaterThan(-1);
  expect(CHAT).toContain('"retry-after"');
  expect(limitAt).toBeLessThan(chargeAt);
});

test("the workspace route exports the shell page, not the draft composer", () => {
  // Regression: DraftChat was accidentally the default export, so /chat
  // rendered a bare composer with no header, sidebar or mobile drawer.
  expect(WORKSPACE).toContain("export default async function ChatPage");
  expect(WORKSPACE.match(/export default/g)?.length).toBe(1);
  expect(WORKSPACE).not.toContain("export default function DraftChat");
});
