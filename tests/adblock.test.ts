import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AD_GATE_CONFIRMATIONS,
  AD_GATE_CONFIRM_MS,
  AD_GATE_EXEMPT_PATHS,
  AD_GATE_RECHECK_MS,
  AD_PROBE_CLASSES,
  AD_PROBE_CONTROL_URL,
  AD_PROBE_MIN_HIDDEN_BAITS,
  AD_PROBE_MIN_REFUSED_HOSTS,
  AD_PROBE_TIMEOUT_MS,
  AD_PROBE_URLS,
  adBlockVerdict,
  decideAdGate,
  isExemptPath,
  isProbeHidden,
  type AdEvidence,
} from "../lib/adblock";

const root = join(import.meta.dir, "..");

function evidence(overrides: Partial<AdEvidence> = {}): AdEvidence {
  return {
    hiddenBaits: 0,
    canaryHidden: false,
    refusedAdRequests: 0,
    adRequests: AD_PROBE_URLS.length,
    control: "ok",
    ...overrides,
  };
}

test("no ad key means no gate, whatever the browser reports", () => {
  expect(
    decideAdGate({ adsConfigured: false, pathname: "/chat", verdict: "blocked" })
  ).toEqual({ block: false, reason: "ads-off" });

  expect(
    decideAdGate({ adsConfigured: false, pathname: "/", verdict: "blocked" })
  ).toEqual({ block: false, reason: "ads-off" });
});

test("a configured deployment blocks a cosmetic finding on product surfaces", () => {
  expect(
    decideAdGate({ adsConfigured: true, pathname: "/chat", verdict: "blocked" })
  ).toEqual({ block: true, reason: "blocked" });

  expect(
    decideAdGate({ adsConfigured: true, pathname: "/activity", verdict: "blocked" })
  ).toEqual({ block: true, reason: "blocked" });

  expect(
    decideAdGate({ adsConfigured: true, pathname: "/chat", verdict: "clear" })
  ).toEqual({ block: false, reason: "clear" });
});

test("operator surfaces stay reachable with a blocker running", () => {
  for (const path of AD_GATE_EXEMPT_PATHS) {
    expect(
      decideAdGate({ adsConfigured: true, pathname: path, verdict: "blocked" })
    ).toEqual({ block: false, reason: "exempt" });
  }

  expect(
    decideAdGate({
      adsConfigured: true,
      pathname: "/admin/probes",
      verdict: "blocked",
    }).block
  ).toBe(false);
});

test("the exemption is a path segment, not a string prefix", () => {
  expect(isExemptPath("/setup")).toBe(true);
  expect(isExemptPath("/setup?step=2")).toBe(true);
  expect(isExemptPath("/admin/")).toBe(true);
  expect(isExemptPath("/setup-notes")).toBe(false);
  expect(isExemptPath("/administrator")).toBe(false);
  expect(isExemptPath("/chat")).toBe(false);
});

test("a bait box counts as hidden when a filter zeroes it out", () => {
  const visible = {
    width: 300,
    height: 250,
    display: "block",
    visibility: "visible",
    opacity: "1",
  };

  expect(isProbeHidden(visible)).toBe(false);
  expect(isProbeHidden({ ...visible, display: "none" })).toBe(true);
  expect(isProbeHidden({ ...visible, width: 0, height: 0 })).toBe(true);
  expect(isProbeHidden({ ...visible, height: 1 })).toBe(true);
  expect(isProbeHidden({ ...visible, visibility: "hidden" })).toBe(true);
  expect(isProbeHidden({ ...visible, visibility: "collapse" })).toBe(true);
  expect(isProbeHidden({ ...visible, opacity: "0" })).toBe(true);
});

test("the probe uses several bait classes, independent hosts and bounded timings", () => {
  expect(AD_PROBE_CLASSES.length).toBeGreaterThanOrEqual(3);
  expect(AD_PROBE_CLASSES).toContain("adsbox");

  // Two readings from two providers: one dead host is not a pattern.
  expect(AD_PROBE_URLS.length).toBeGreaterThanOrEqual(2);
  expect(new Set(AD_PROBE_URLS.map((url) => new URL(url).origin)).size).toBe(
    AD_PROBE_URLS.length
  );
  // The provider this app actually serves banners from is probed directly.
  expect(AD_PROBE_URLS.some((url) => url.includes("highperformanceformat"))).toBe(
    true
  );

  expect(AD_PROBE_TIMEOUT_MS).toBeGreaterThan(0);
  expect(AD_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  expect(AD_GATE_RECHECK_MS).toBeGreaterThanOrEqual(1_000);
  expect(AD_PROBE_MIN_REFUSED_HOSTS).toBeGreaterThanOrEqual(2);
});

test("a network that cannot reach this page is never read as an ad blocker", () => {
  for (const control of ["failed", "timeout"] as const) {
    expect(adBlockVerdict(evidence({ refusedAdRequests: 2, control }))).toBe(
      "clear"
    );
    // Even hidden baits do not override \"this browser cannot reach us\": a
    // captive portal can leave a half-rendered page behind.
    expect(
      adBlockVerdict(evidence({ hiddenBaits: 3, refusedAdRequests: 2, control }))
    ).toBe("clear");
  }
});

test("a hidden canary throws the whole reading away", () => {
  // The neutral box disappeared too, so the hiding was not ad-specific.
  expect(
    adBlockVerdict(
      evidence({ hiddenBaits: 6, refusedAdRequests: 2, canaryHidden: true })
    )
  ).toBe("clear");
});

test("refused ad requests alone stay a suspicion forever", () => {
  // A corporate proxy, a school network, a DNS filter, a Pi-hole, a captive
  // portal and a split-tunnel VPN all look like this while the browser is fine.
  expect(adBlockVerdict(evidence({ refusedAdRequests: 1 }))).toBe("suspicious");
  expect(adBlockVerdict(evidence({ refusedAdRequests: 2 }))).toBe("suspicious");

  // No number of agreeing checks turns that into a wall.
  expect(
    decideAdGate({
      adsConfigured: true,
      pathname: "/chat",
      verdict: "suspicious",
      confirmations: 99,
    })
  ).toEqual({ block: false, reason: "unconfirmed" });
});

test("a timeout is not a refusal, in either direction", () => {
  // One host refused and one was too slow: that is one refusal, not two.
  expect(
    adBlockVerdict(
      evidence({ hiddenBaits: 1, refusedAdRequests: 1, adRequests: 2 })
    )
  ).toBe("suspicious");

  // A slow ad host with nothing hidden says nothing at all.
  expect(
    adBlockVerdict(evidence({ refusedAdRequests: 0, control: "ok" }))
  ).toBe("clear");
});

test("two hidden baits are a filter; one is only corroboration", () => {
  expect(adBlockVerdict(evidence())).toBe("clear");
  expect(adBlockVerdict(evidence({ hiddenBaits: 1 }))).toBe("suspicious");
  expect(adBlockVerdict(evidence({ hiddenBaits: 2 }))).toBe("blocked");

  // One hidden bait plus both ad hosts refusing is two independent signals.
  expect(
    adBlockVerdict(evidence({ hiddenBaits: 1, refusedAdRequests: 2 }))
  ).toBe("blocked");

  // One hidden bait plus one refused host is not.
  expect(
    adBlockVerdict(evidence({ hiddenBaits: 1, refusedAdRequests: 1 }))
  ).toBe("suspicious");
});

test("a single sighting does not raise the wall", () => {
  const seen = {
    adsConfigured: true,
    pathname: "/chat",
    verdict: "blocked" as const,
  };

  expect(decideAdGate({ ...seen, confirmations: 1 })).toEqual({
    block: false,
    reason: "unconfirmed",
  });

  expect(decideAdGate({ ...seen, confirmations: 2 })).toEqual({
    block: true,
    reason: "blocked",
  });

  // A page that has turned clear again drops the wall on the spot.
  expect(
    decideAdGate({ ...seen, verdict: "clear", confirmations: 0 })
  ).toEqual({ block: false, reason: "clear" });
});

test("the confirmation and control constants are the cautious ones", () => {
  expect(AD_GATE_CONFIRMATIONS).toBeGreaterThanOrEqual(2);
  expect(AD_GATE_CONFIRM_MS).toBeGreaterThan(0);
  expect(AD_PROBE_MIN_HIDDEN_BAITS).toBeGreaterThanOrEqual(2);
  // The control probe has to stay on this origin, or it proves nothing about
  // the network the app is served over.
  expect(AD_PROBE_CONTROL_URL.startsWith("/")).toBe(true);
});

test("the gate is mounted once in the root layout and is client-only", () => {
  const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");
  expect(layout).toContain('from "@/components/AdBlockGate"');
  expect(layout).toContain("<AdBlockGate />");

  const component = readFileSync(
    join(root, "components/AdBlockGate.tsx"),
    "utf8"
  );

  expect(component.startsWith('"use client";')).toBe(true);
  expect(component).toContain("aria-modal");
  expect(component).toContain("decideAdGate");
  // The component asks the policy; it does not decide by itself.
  expect(component).toContain("adBlockVerdict");
  // A hidden tab and a sleeping laptop are not evidence about ads.
  expect(component).toContain("document.visibilityState");
  expect(component).toContain("probeUrl(AD_PROBE_CONTROL_URL)");
  // Every configured host is probed, the neutral canary guards the baits, and
  // the probe stage is removed even when a measurement throws.
  expect(component).toContain("AD_PROBE_URLS.map");
  expect(component).toContain("canary");
  expect(component).toContain("getClientRects");
  expect(component).toContain("finally");
});
