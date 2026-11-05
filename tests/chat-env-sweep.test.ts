import { expect, test } from "bun:test";

import { readFileSync } from "node:fs";

/**
 * Sweep contracts.
 *
 * The route has no pure half to test by execution without a provider, so the
 * safety properties are asserted where they live: authentication before any
 * work, wipe before stop before reconcile, leases filtered in every pass, and
 * a dry run that writes nothing.
 */

const sweep = readFileSync("app/api/cron/sandbox-sweep/route.ts", "utf8");
const store = readFileSync("lib/execution/chat-env/store.ts", "utf8");
const provider = readFileSync("lib/execution/provider.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons?: Array<{ path: string; schedule: string }>;
};

function at(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle);
  expect(index).toBeGreaterThan(-1);
  return index;
}

test("the sweep refuses to run without a secret and compares it in constant time", () => {
  expect(sweep).toContain("CRON_SECRET");
  expect(sweep).toContain("timingSafeEqual");
  expect(sweep).toContain("createHash");
  expect(sweep).toContain("503");

  expect(at(sweep, "secret.length === 0")).toBeLessThan(at(sweep, "const dryRun"));
  expect(at(sweep, "!authorised(request, secret)")).toBeLessThan(
    at(sweep, "const due = await listChatSandboxesDue")
  );
});

test("wiping happens before stopping, and both before reconciliation", () => {
  expect(at(sweep, 'pass: "expire"')).toBeLessThan(at(sweep, 'pass: "stop"'));
  expect(at(sweep, 'pass: "stop"')).toBeLessThan(at(sweep, 'pass: "reconcile"'));

  expect(at(sweep, "destroySandboxConfirmed(row.sandboxId)")).toBeLessThan(
    at(sweep, "deleteChatSandboxRow(admin, row.id)")
  );
  expect(at(sweep, "deleteChatSandboxRow(admin, row.id)")).toBeLessThan(
    at(sweep, "handle.stop(")
  );
});

test("every pass honours a live lease", () => {
  const islands = sweep.match(/isLeaseLive\(row\.leaseUntil, now\)/g) ?? [];
  expect(islands.length).toBe(2);

  // The queries filter leases too; the caller's check is the race guard.
  const due = store.slice(at(store, "export async function listChatSandboxesDue"), at(store, "export async function listChatSandboxesIdle"));
  const idle = store.slice(at(store, "export async function listChatSandboxesIdle"), at(store, "export async function listChatSandboxIds"));

  expect(due).toContain("lease_until.is.null,lease_until.lt.");
  expect(idle).toContain("lease_until.is.null,lease_until.lt.");
  expect(idle).toContain('eq("state", "running")');
});

test("a dry run reports actions without writing", () => {
  expect(sweep).toContain('searchParams.get("dry") === "1"');

  const dryBranches = sweep.match(/if \(dryRun\) \{/g) ?? [];
  expect(dryBranches.length).toBeGreaterThanOrEqual(3);

  // The dry branch must come before the first write in each pass.
  const expire = sweep.slice(at(sweep, 'pass: "expire"'), at(sweep, 'pass: "stop"'));
  expect(at(expire, "if (dryRun)")).toBeLessThan(at(expire, "updateChatSandbox("));
});

test("a failed wipe keeps the row and counts the attempt", () => {
  const expire = sweep.slice(at(sweep, 'pass: "expire"'), at(sweep, 'pass: "stop"'));

  expect(expire).toContain("wipe_attempts: row.wipeAttempts + 1");
  expect(expire).toContain("wipe_failed");

  // The delete is inside the try, after the provider confirms; the catch must
  // not delete the row.
  const failure = expire.slice(at(expire, "} catch (caught) {"));
  expect(failure.slice(0, 700)).not.toContain("deleteChatSandboxRow");
});

test("reconciliation only destroys boxes older than the provisioning window", () => {
  const reconcile = sweep.slice(at(sweep, 'pass: "reconcile"'));

  expect(reconcile).toContain("created + CHAT_SANDBOX_PROVISION_ORPHAN_MS > now");
  expect(reconcile).toContain("listChatSandboxes");
  expect(reconcile).toContain("listChatSandboxIds");
});

test("the provider exposes a confirmed delete and a labelled list", () => {
  expect(provider).toContain("export async function destroySandboxConfirmed");
  expect(provider).toContain('labels: { app: "openmi", kind: "chat" }');
  expect(provider).toContain("if (error.failure === \"missing\") return \"missing\"");
});

test("the sweep is scheduled", () => {
  expect(vercel.crons).toEqual([
    { path: "/api/cron/sandbox-sweep", schedule: "0 5 * * *" },
  ]);
});
