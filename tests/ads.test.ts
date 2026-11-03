import { expect, test } from "bun:test";

import { AD_SLOTS, buildAdConfig, parseAdKey } from "../lib/ads";

test("a missing or malformed key leaves the slot unconfigured", () => {
  expect(parseAdKey(undefined)).toBeNull();
  expect(parseAdKey("")).toBeNull();
  expect(parseAdKey("   ")).toBeNull();
  expect(parseAdKey("short")).toBeNull();
  expect(parseAdKey("not-a-key")).toBeNull();
  expect(parseAdKey("<script>alert(1)</script>")).toBeNull();
  expect(buildAdConfig("leaderboard", "")).toBeNull();
});

test("a configured slot keeps its reserved sizes and builds an https loader", () => {
  const config = buildAdConfig("leaderboard", "  abc123def456  ");

  expect(config).not.toBeNull();
  expect(config?.key).toBe("abc123def456");
  expect(config?.width).toBe(728);
  expect(config?.height).toBe(90);
  expect(config?.src).toBe(
    "https://www.highperformanceformat.com/abc123def456/invoke.js"
  );
});

test("every slot reserves a real box", () => {
  for (const slot of Object.values(AD_SLOTS)) {
    expect(slot.width).toBeGreaterThanOrEqual(300);
    expect(slot.height).toBeGreaterThanOrEqual(50);
  }

  expect(AD_SLOTS.mobile.width).toBeLessThan(AD_SLOTS.leaderboard.width);
  expect(AD_SLOTS.rectangle.height).toBeGreaterThan(AD_SLOTS.leaderboard.height);
});
