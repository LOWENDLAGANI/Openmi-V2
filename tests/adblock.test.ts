import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AD_GATE_EXEMPT_PATHS,
  AD_GATE_RECHECK_MS,
  AD_PROBE_CLASSES,
  AD_PROBE_TIMEOUT_MS,
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
});
