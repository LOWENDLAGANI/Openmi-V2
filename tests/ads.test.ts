import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AD_SLOTS,
  adOrigins,
  buildAdConfig,
  parseAdKey,
  parseAdSrc,
  showComposerAd,
} from "../lib/ads";

const root = join(import.meta.dir, "..");

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

test("a unit's own loader URL wins, and is validated before it ships", () => {
  const unit = "https://bauval.org/22/0657afefd34c7fc42e1493b73e14ea57";
  const config = buildAdConfig("mobile", "abc123def456", unit);

  expect(config?.src).toBe(unit);
  // The unit is a 320×50, which is the slot it belongs in.
  expect(config?.width).toBe(320);
  expect(config?.height).toBe(50);

  // No override keeps the host older keys were issued for.
  expect(buildAdConfig("mobile", "abc123def456")?.src).toBe(
    "https://www.highperformanceformat.com/abc123def456/invoke.js"
  );

  // A malformed source is treated as unset, never spliced into the frame.
  expect(parseAdSrc("http://bauval.org/22/abc")).toBeNull();
  expect(parseAdSrc("javascript:alert(1)")).toBeNull();
  expect(parseAdSrc('https://bauval.org/22/abc"><script>')).toBeNull();
  expect(parseAdSrc("//bauval.org/22/abc")).toBeNull();
  expect(parseAdSrc("https://localhost/22/abc")).toBeNull();
  expect(parseAdSrc("")).toBeNull();
  expect(parseAdSrc(undefined)).toBeNull();
  expect(parseAdSrc(unit)?.startsWith("https://bauval.org/22/")).toBe(true);
});

test("the probe follows the hosts the configured units load from", () => {
  const savedKey = process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_KEY;
  const savedSrc = process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_SRC;

  try {
    process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_KEY = "abc123def456";
    process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_SRC =
      "https://bauval.org/22/abc123def456";

    expect(adOrigins()).toEqual(["https://bauval.org"]);
  } finally {
    if (savedKey === undefined) delete process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_KEY;
    else process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_KEY = savedKey;

    if (savedSrc === undefined) delete process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_SRC;
    else process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_SRC = savedSrc;
  }
});

test("every slot reserves a real box", () => {
  for (const slot of Object.values(AD_SLOTS)) {
    expect(slot.width).toBeGreaterThanOrEqual(300);
    expect(slot.height).toBeGreaterThanOrEqual(50);
  }

  expect(AD_SLOTS.mobile.width).toBeLessThan(AD_SLOTS.leaderboard.width);
  expect(AD_SLOTS.rectangle.height).toBeGreaterThan(AD_SLOTS.leaderboard.height);
});

test("the composer unit only exists inside a stored conversation", () => {
  expect(showComposerAd(null)).toBe(false);
  expect(showComposerAd("")).toBe(false);
  expect(showComposerAd("   ")).toBe(false);
  expect(showComposerAd("8c1d0c40-7f4c-4a54-9d8f-0a0b6a0f3e21")).toBe(true);
});

test("sign-in mounts no advertisement at all", () => {
  const login = readFileSync(join(root, "app/login/page.tsx"), "utf8");

  for (const marker of ["AdSlot", "AdBanner", "advertisement"]) {
    expect(login).not.toContain(marker);
  }
});

test("the composer renders its unit behind that check, exactly once", () => {
  const panel = readFileSync(join(root, "components/ChatPanel.tsx"), "utf8");
  const guard = panel.indexOf("showComposerAd(activeChatId)");
  const slot = panel.indexOf("<AdSlot");

  expect(guard).toBeGreaterThan(-1);
  expect(slot).toBeGreaterThan(guard);
  expect(panel.match(/<AdSlot/g)?.length).toBe(1);
});
