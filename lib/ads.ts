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
  /** Adsterra's invoke script for this key. */
  src: string;
};

/** Adsterra keys are alphanumeric; anything else is treated as unset. */
export function parseAdKey(value: string | null | undefined): string | null {
  const key = (value ?? "").trim();
  if (!/^[A-Za-z0-9]{6,64}$/.test(key)) return null;
  return key;
}

export function buildAdConfig(
  slot: AdSlotId,
  key: string | null | undefined
): AdConfig | null {
  const parsed = parseAdKey(key);
  if (!parsed) return null;

  return {
    ...AD_SLOTS[slot],
    key: parsed,
    src: `https://www.highperformanceformat.com/${parsed}/invoke.js`,
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
        process.env.NEXT_PUBLIC_ADSTERRA_LEADERBOARD_KEY
      );
    case "mobile":
      return buildAdConfig(slot, process.env.NEXT_PUBLIC_ADSTERRA_MOBILE_KEY);
    case "rectangle":
      return buildAdConfig(
        slot,
        process.env.NEXT_PUBLIC_ADSTERRA_RECTANGLE_KEY
      );
  }
}
