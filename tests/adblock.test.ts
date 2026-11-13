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
  AD_PROBE_TIMEOUT_MS,
  adBlockVerdict,
  decideAdGate,
  isExemptPath,
  isProbeHidden,
} from "../lib/adblock";

const root = join(import.meta.dir, "..");

test("no ad key means no gate, whatever the browser reports", () => {
  expect(
    decideAdGate({ adsConfigured: false, pathname: "/chat", detected: true })
  ).toEqual({ block: false, reason: "ads-off" });

  expect(
    decideAdGate({ adsConfigured: false, pathname: "/", detected: true })
  ).toEqual({ block: false, reason: "ads-off" });
});

test("a configured deployment blocks a detected blocker on product surfaces", () => {
  expect(
    decideAdGate({ adsConfigured: true, pathname: "/chat", detected: true })
  ).toEqual({ block: true, reason: "blocked" });

  expect(
    decideAdGate({ adsConfigured: true, pathname: "/activity", detected: true })
  ).toEqual({ block: true, reason: "blocked" });

  expect(
    decideAdGate({ adsConfigured: true, pathname: "/chat", detected: false })
  ).toEqual({ block: false, reason: "clear" });
});

test("operator surfaces stay reachable with a blocker running", () => {
  for (const path of AD_GATE_EXEMPT_PATHS) {
    expect(
      decideAdGate({ adsConfigured: true, pathname: path, detected: true })
    ).toEqual({ block: false, reason: "exempt" });
  }

  expect(
    decideAdGate({ adsConfigured: true, pathname: "/admin/probes", detected: true })
      .block
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
  expect(isProbeHidden({ ...visible, opacity: "0" })).toBe(true);
});

test("the probe uses several bait classes and bounded timings", () => {
  expect(AD_PROBE_CLASSES.length).toBeGreaterThanOrEqual(3);
  expect(AD_PROBE_CLASSES).toContain("adsbox");
  expect(AD_PROBE_TIMEOUT_MS).toBeGreaterThan(0);
  expect(AD_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  expect(AD_GATE_RECHECK_MS).toBeGreaterThanOrEqual(1_000);
});

test("a refused ad request on its own is a suspicion, not a verdict", () => {
  // DNS filtering, a corporate proxy, a privacy DNS or a captive portal all
  // refuse this request while the browser works perfectly well.
  expect(adBlockVerdict({ hiddenBaits: 0, ad: "failed", control: "ok" })).toBe(
    "suspicious"
  );
});

test("a network that fails both probes is never read as an ad blocker", () => {
  for (const control of ["failed", "timeout"] as const) {
    expect(adBlockVerdict({ hiddenBaits: 0, ad: "failed", control })).toBe("clear");
    // Even a hidden bait does not override "this browser cannot reach us".
    expect(adBlockVerdict({ hiddenBaits: 3, ad: "failed", control })).toBe("clear");
  }

  // A slow ad host the browser aborted is not a filter refusing it.
  expect(adBlockVerdict({ hiddenBaits: 0, ad: "timeout", control: "ok" })).toBe(
    "clear"
  );
  expect(adBlockVerdict({ hiddenBaits: 3, ad: "timeout", control: "ok" })).toBe(
    "blocked"
  );
});

test("two hidden baits are a filter; one is only corroboration", () => {
  expect(adBlockVerdict({ hiddenBaits: 0, ad: "ok", control: "ok" })).toBe("clear");
  expect(adBlockVerdict({ hiddenBaits: 1, ad: "ok", control: "ok" })).toBe("clear");
  expect(adBlockVerdict({ hiddenBaits: 2, ad: "ok", control: "ok" })).toBe("blocked");
  // One hidden bait plus a refused ad request is two independent signals.
  expect(adBlockVerdict({ hiddenBaits: 1, ad: "failed", control: "ok" })).toBe(
    "blocked"
  );
});

test("a single sighting does not raise the wall", () => {
  const seen = { adsConfigured: true, pathname: "/chat", detected: true };

  expect(decideAdGate({ ...seen, confirmations: 1 })).toEqual({
    block: false,
    reason: "unconfirmed",
  });

  expect(decideAdGate({ ...seen, confirmations: 2 })).toEqual({
    block: true,
    reason: "blocked",
  });

  // A page that has turned clear again drops the wall on the spot.
  expect(decideAdGate({ ...seen, detected: false, confirmations: 0 })).toEqual({
    block: false,
    reason: "clear",
  });
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
});
