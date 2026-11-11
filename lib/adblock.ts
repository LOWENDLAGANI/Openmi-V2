/**
 * Ad-blocker gate policy.
 *
 * The app is paid for by the banners under each page, so a browser that hides
 * them is a browser the product cannot afford to serve. Detection happens in
 * the browser — nothing about a visitor is sent anywhere to decide this.
 *
 * Two rules keep the gate honest:
 *
 * 1. It never engages unless at least one Adsterra key is configured. With no
 *    keys there are no ads to protect, so a dev checkout, a CI run or a fresh
 *    deploy with an empty env is never walled off.
 * 2. The setup and admin surfaces stay open to operators. Locking the person
 *    who configures the deployment out of the configuration page would turn a
 *    revenue guard into a support incident.
 *
 * Everything here is pure so the policy can be tested without a DOM.
 */

/** Class names ad blockers hide by cosmetic filter. Any one hidden means blocked. */
export const AD_PROBE_CLASSES = [
  "adsbox",
  "ad-banner",
  "ad-placement",
  "pub_300x250",
  "text-ad",
  "banner-ad",
] as const;

/** A request no ad blocker lets through; the response is opaque and never used. */
export const AD_PROBE_URL =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

/** The bait box is a real 300×250, the most commonly targeted ad size. */
export const AD_PROBE_SIZE = { width: 300, height: 250 } as const;

/** How long a network probe may take before it is treated as "no answer". */
export const AD_PROBE_TIMEOUT_MS = 2_000;

/** How often the gate re-checks while the tab is open. */
export const AD_GATE_RECHECK_MS = 5_000;

/** Prefixes that must stay reachable so an operator can fix the deployment. */
export const AD_GATE_EXEMPT_PATHS = ["/setup", "/admin"] as const;

export type AdGateReason = "ads-off" | "exempt" | "clear" | "blocked";

export type AdGateDecision = {
  /** Whether to replace the page with the blocking notice. */
  block: boolean;
  reason: AdGateReason;
};

/** A path is exempt when it is the prefix itself or sits underneath it. */
export function isExemptPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] ?? "/").split("#")[0] || "/";

  return AD_GATE_EXEMPT_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

export function decideAdGate(input: {
  adsConfigured: boolean;
  pathname: string;
  detected: boolean;
}): AdGateDecision {
  if (!input.adsConfigured) return { block: false, reason: "ads-off" };
  if (isExemptPath(input.pathname)) return { block: false, reason: "exempt" };
  if (!input.detected) return { block: false, reason: "clear" };

  return { block: true, reason: "blocked" };
}

export type ProbeBox = {
  width: number;
  height: number;
  display: string;
  visibility: string;
  opacity: string;
};

/**
 * A bait element counts as hidden when a filter removed it from layout, from
 * paint, or from the accessibility tree's equivalent of both. `display: none`
 * and a zero box are the two shapes uBlock-style lists use; the visibility and
 * opacity checks catch lists that fade an element instead of collapsing it.
 */
export function isProbeHidden(box: ProbeBox): boolean {
  if (box.display === "none") return true;
  if (box.visibility === "hidden" || box.visibility === "collapse") return true;
  if (Number.parseFloat(box.opacity || "1") === 0) return true;

  return box.width <= 1 || box.height <= 1;
}
