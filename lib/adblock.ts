/**
 * Ad-blocker gate policy.
 *
 * The app is paid for by the banners under each page, so a browser that hides
 * them is a browser the product cannot afford to serve. Detection happens in
 * the browser — nothing about a visitor is sent anywhere to decide this.
 *
 * Three rules keep the gate honest:
 *
 * 1. It never engages unless at least one Adsterra key is configured. With no
 *    keys there are no ads to protect, so a dev checkout, a CI run or a fresh
 *    deploy with an empty env is never walled off.
 * 2. The setup and admin surfaces stay open to operators. Locking the person
 *    who configures the deployment out of the configuration page would turn a
 *    revenue guard into a support incident.
 * 3. No single failed probe is proof. A request can be refused by a captive
 *    portal, a corporate proxy, a DNS filter or a tab that just woke up, and a
 *    page that accuses a normal browser of blocking ads is worse than one that
 *    misses an occasional blocker: the reader has no way to argue with a wall.
 *
 * Everything here is pure so the policy can be tested without a DOM.
 */

/** Class names ad blockers hide by cosmetic filter. */
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

/**
 * A same-origin request made beside the ad probe.
 *
 * The control is what separates "a filter refused this one host" from "this
 * browser could not reach anything". Both failing is a network problem, and a
 * network problem is not evidence about ads.
 */
export const AD_PROBE_CONTROL_URL = "/favicon.ico";

/** The bait box is a real 300×250, the most commonly targeted ad size. */
export const AD_PROBE_SIZE = { width: 300, height: 250 } as const;

/** How long a network probe may take before it is treated as "no answer". */
export const AD_PROBE_TIMEOUT_MS = 2_000;

/**
 * How many bait boxes a filter has to hide before the page believes it.
 *
 * One disappearing div can be a stylesheet, an extension that hides a single
 * selector, or a filter rule that happens to match something else. Two
 * different ad class names going missing is a filter list at work.
 */
export const AD_PROBE_MIN_HIDDEN_BAITS = 2;

/** How often the gate re-checks while the tab is open. */
export const AD_GATE_RECHECK_MS = 5_000;

/** The gap between a first sighting and the check that confirms it. */
export const AD_GATE_CONFIRM_MS = 1_200;

/** Consecutive agreeing checks before the gate is shown. */
export const AD_GATE_CONFIRMATIONS = 2;

/** Prefixes that must stay reachable so an operator can fix the deployment. */
export const AD_GATE_EXEMPT_PATHS = ["/setup", "/admin"] as const;

export type AdGateReason =
  | "ads-off"
  | "exempt"
  | "clear"
  | "unconfirmed"
  | "blocked";

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
  /**
   * How many consecutive checks reached the same conclusion.
   *
   * A single sighting is not enough by default: the caller passes its streak,
   * and the wall only appears once that streak reaches AD_GATE_CONFIRMATIONS.
   */
  confirmations?: number;
}): AdGateDecision {
  if (!input.adsConfigured) return { block: false, reason: "ads-off" };
  if (isExemptPath(input.pathname)) return { block: false, reason: "exempt" };
  if (!input.detected) return { block: false, reason: "clear" };

  const confirmations = input.confirmations ?? AD_GATE_CONFIRMATIONS;
  if (confirmations < AD_GATE_CONFIRMATIONS) {
    return { block: false, reason: "unconfirmed" };
  }

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

/** What one request to a probe host came back with. */
export type ProbeAnswer = "ok" | "failed" | "timeout";

export type AdEvidence = {
  /** How many of AD_PROBE_CLASSES a filter hid. */
  hiddenBaits: number;
  ad: ProbeAnswer;
  control: ProbeAnswer;
};

/** What the probes add up to, before confirmation. */
export type AdVerdict = "clear" | "suspicious" | "blocked";

/**
 * Reads the evidence without over-claiming.
 *
 * - Both requests failing is the network, not a filter, so it is clear. An
 *   offline browser, a captive portal and a proxy all land here.
 * - Two hidden baits are a cosmetic filter on their own, whatever the network
 *   was doing at the time: the hiding happened locally and needs no request.
 * - A slow ad request is a slow ad request. A timeout that the browser aborted
 *   is not a refusal, so it is clear too.
 * - One hidden bait plus a refused ad request is two independent signals, and
 *   the two together are enough.
 * - A refused ad request on its own is "suspicious" and only becomes a wall
 *   after the caller has seen it confirmed.
 */
export function adBlockVerdict(evidence: AdEvidence): AdVerdict {
  if (evidence.control !== "ok") return "clear";
  if (evidence.hiddenBaits >= AD_PROBE_MIN_HIDDEN_BAITS) return "blocked";
  if (evidence.ad === "timeout") return "clear";
  if (evidence.hiddenBaits >= 1 && evidence.ad === "failed") return "blocked";
  if (evidence.ad === "failed") return "suspicious";

  return "clear";
}
