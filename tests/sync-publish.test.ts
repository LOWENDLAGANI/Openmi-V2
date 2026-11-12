import { expect, test } from "bun:test";

import {
  PULL_CONFIRMATION,
  isPinnableSha,
  syncVerdict,
} from "../lib/execution/sync/plan";
import {
  deploymentUrl,
  isLivePublishState,
  isPublishableBranch,
  isPublishableSha,
  mapProviderState,
  projectNameFor,
  publishEnabled,
} from "../lib/publish/plan";

/**
 * Two rules that are easy to get subtly wrong: the order a pull is refused in,
 * and whether a deployment may show a link. The second is the honesty rule of
 * the publish phase — a URL is rendered only for a provider-reported `READY`.
 */

const HEAD = "a".repeat(40);
const PINNED = "b".repeat(40);

test("a pull refuses a live turn before it refuses a dirty tree", () => {
  const base = {
    pinnedSha: PINNED,
    headSha: HEAD,
    leaseLive: false,
    provisioning: false,
    dirtyFiles: 0,
  };

  expect(syncVerdict({ ...base, pinnedSha: null })).toBe("no-repository");
  expect(syncVerdict({ ...base, headSha: PINNED })).toBe("up-to-date");
  expect(syncVerdict({ ...base, leaseLive: true })).toBe("busy");
  expect(syncVerdict({ ...base, provisioning: true })).toBe("busy");
  expect(syncVerdict({ ...base, dirtyFiles: 2 })).toBe("uncommitted");
  expect(syncVerdict(base)).toBe("pull");

  // A turn that is also dirty is reported as a turn, not as the files.
  expect(syncVerdict({ ...base, leaseLive: true, dirtyFiles: 3 })).toBe("busy");
});

test("the confirmation says what a pull costs", () => {
  expect(PULL_CONFIRMATION).toContain("versions");
  expect(PULL_CONFIRMATION).toContain("reseeded");
  expect(PULL_CONFIRMATION).toContain("GitHub is not changed");
});

test("only a commit sha is pinnable", () => {
  expect(isPinnableSha(PINNED)).toBe(true);
  expect(isPinnableSha("b".repeat(6))).toBe(false);
  expect(isPinnableSha("B".repeat(40))).toBe(false);
  expect(isPinnableSha("HEAD")).toBe(false);
});

test("provider states are mapped without inventing success", () => {
  expect(mapProviderState("QUEUED")).toBe("queued");
  expect(mapProviderState("INITIALIZING")).toBe("queued");
  expect(mapProviderState("BUILDING")).toBe("building");
  expect(mapProviderState("READY")).toBe("ready");
  expect(mapProviderState("ERROR")).toBe("error");
  expect(mapProviderState("CANCELED")).toBe("cancelled");
  expect(mapProviderState("SOMETHING_NEW")).toBe("unknown");
  expect(mapProviderState(null)).toBe("unknown");

  expect(isLivePublishState("queued")).toBe(true);
  expect(isLivePublishState("building")).toBe(true);
  expect(isLivePublishState("ready")).toBe(false);
  expect(isLivePublishState("error")).toBe(false);
});

test("a link exists only for a ready deployment", () => {
  expect(deploymentUrl("ready", "app-abc.vercel.app")).toBe(
    "https://app-abc.vercel.app"
  );
  expect(deploymentUrl("ready", "https://app.vercel.app")).toBe(
    "https://app.vercel.app"
  );

  for (const state of ["queued", "building", "error", "cancelled", "unknown"] as const) {
    expect(deploymentUrl(state, "app-abc.vercel.app")).toBeNull();
  }

  expect(deploymentUrl("ready", null)).toBeNull();
  expect(deploymentUrl("ready", "   ")).toBeNull();
});

test("project names are slugs the provider will accept", () => {
  expect(projectNameFor("octo/my-app")).toBe("my-app");
  expect(projectNameFor("octo/My_App.v2")).toBe("my-app-v2");
  expect(projectNameFor("octo/---")).toBe("openmi-app");
  expect(projectNameFor(null)).toBe("openmi-app");
  expect(projectNameFor("octo/" + "a".repeat(80)).length).toBeLessThanOrEqual(52);
});

test("refs and shas are checked before a provider sees them", () => {
  expect(isPublishableBranch("main")).toBe(true);
  expect(isPublishableBranch("openmi/agent/abc")).toBe(true);

  for (const bad of ["", "-x", "/main", "main/", "a..b", "a//b", "a b", "a;rm", null, 5]) {
    expect(isPublishableBranch(bad)).toBe(false);
  }

  expect(isPublishableSha(HEAD)).toBe(true);
  expect(isPublishableSha("zzzzzzz")).toBe(false);
});

test("publishing needs the operator's token", () => {
  expect(publishEnabled({})).toBe(false);
  expect(publishEnabled({ VERCEL_TOKEN: "   " })).toBe(false);
  expect(publishEnabled({ VERCEL_TOKEN: "t" })).toBe(true);
});
