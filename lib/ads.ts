/**
 * Adsterra banner slots.
 *
 * The keys are public by nature (they ship in the page), so they live in
 * `NEXT_PUBLIC_` variables. An unset or malformed key is not an error: the slot
 * still renders, with its exact dimensions reserved, so the layout is identical
 * before and after the ad account is switched on. That is what stops a late ad
 * from shoving the page around.
 *
 * Adsterra's loader uses `document.write`, which must not run against this
 * document. The component renders it inside an iframe instead, so a lazy or
 * broken ad can only blank its own frame.
 *
 * The loader URL is per unit, not per key: Adsterra hands out a different host
 * and path for different units (`…/<key>/invoke.js`, `https://bauval.org/22/<key>`),
 * and a key cannot reconstruct the one it came with. So a slot takes its exact
 * URL from configuration and falls back to the historical host and path, which
 * is what a key from an older dashboard still expects.
 */

export type AdSlotId = "leaderboard" | "mobile" | "rectangle";

export type AdSlotSpec = {
  id: AdSlotId;
  label: string;
  /** Reserved width in CSS pixels. */
  width: number;
  /** Reserved height in CSS pixels. */
  height: number;
};

export const AD_SLOTS: Record<AdSlotId, AdSlotSpec> = {
  leaderboard: { id: "leaderboard", label: "Leaderboard", width: 728, height: 90 },
  mobile: { id: "mobile", label: "Mobile banner", width: 320, height: 50 },
  rectangle: { id: "rectangle", label: "Rectangle", width: 300, height: 250 },
};

export type AdConfig = AdSlotSpec & {
  key: string;
  /** The unit's invoke script: its configured URL, or the historical one. */
  src: string;
};

/** Adsterra keys are alphanumeric; anything else is treated as unset. */
export function parseAdKey(value: string | null | undefined): string | null {
  const key = (value ?? "").trim();
  if (!/^[A-Za-z0-9]{6,64}$/.test(key)) return null;
  return key;
}

/**
 * The exact URL Adsterra prints for a unit, or null.
 *
 * It is not derived from the key, so it is configuration and gets validated
 * like configuration: https only, a real hostname, and nothing that could close
 * the attribute it lands in. An ad frame is never worth loading over http, and
 * a stored value that fails here is treated as unset rather than trusted.
 */
export function parseAdSrc(value: string | null | undefined): string | null {
  const src = (value ?? "").trim();
  if (src.length === 0 || src.length > 500) return null;
  if (/[\s"'<>]/.test(src)) return null;

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname.includes(".")) return null;

  return parsed.toString();
}

/**
 * One slot's configuration.
 *
 * `src` is the unit's own loader, which wins when it is set and valid. Without
 * it the key keeps the host this app has always used, so an existing
 * deployment does not change behaviour by upgrading.
 */
export function buildAdConfig(
  slot: AdSlotId,
  key: string | null | undefined,
  src?: string | null
): AdConfig | null {
  const parsed = parseAdKey(key);
  if (!parsed) return null;

  return {
    ...AD_SLOTS[slot],
    key: parsed,
    src:
      parseAdSrc(src) ??
      `https://www.highperformanceformat.com/${parsed}/invoke.js`,
  };
}

/**
 * The unit above the composer belongs to a conversation, not to a page.
 *
 * Only a stored chat has one: the new-chat screen has no conversation to sit
 * above, and a temporary chat — if one is ever added — is never written to the
 * database, so it can never satisfy this. Sign-in is a separate page that
 * mounts no ad at all.
 */
export function showComposerAd(chatId: string | null): boolean {
  return typeof chatId === "string" && chatId.trim().length > 0;
}

/**
 * Reads the key for a slot. Each branch names its variable literally so the
 * Next compiler can inline it into the client bundle; a computed `env[name]`
 * would arrive as `undefined` in the browser.
 */
export function adConfig(slot: AdSlotId): AdConfig | null {
  switch (slot) {
    case "leaderboard":
      return buildAdConfig(
        slot,
        process.env.NEXT_PUBLIC_ADSTERRA_LEADERBOARD_KEY,
        process.env.NEXT_PUBLIC_ADSTERRA_LEADERBOARD_SRC
      );
    case "mobile":
      return buildAdConfig(
        slot,
        process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_KEY,
        process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_SRC
      );
    case "rectangle":
      return buildAdConfig(
        slot,
        process.env.NEXT_PUBLIC_ADSTERRA_RECTANGLE_KEY,
        process.env.NEXT_PUBLIC_ADSTERRA_RECTANGLE_SRC
      );
  }
}

/**
 * The hosts this deployment actually loads its units from.
 *
 * The ad-block gate probes these first, because a filter that hides the banner
 * on this page is the thing the gate exists to see. Reading the configured
 * loader rather than a constant is what keeps the probe honest when a unit
 * moves to another Adsterra host.
 */
export function adOrigins(): string[] {
  const origins = new Set<string>();

  for (const slot of Object.keys(AD_SLOTS) as AdSlotId[]) {
    const config = adConfig(slot);
    if (!config) continue;

    try {
      origins.add(new URL(config.src).origin);
    } catch {
      // `parseAdSrc` already refused anything that is not a URL.
    }
  }

  return [...origins];
}
