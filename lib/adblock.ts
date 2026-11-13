/**
 * Ad-blocker gate policy.
 *
 * The app is paid for by the banners under each page, so a browser that hides
 * them is a browser the product cannot afford to serve. Detection happens in
 * the browser — nothing about a visitor is sent anywhere to decide this.
 *
 * Four rules keep the gate honest:
 *
 * 1. It never engages unless at least one Adsterra key is configured. With no
 *    keys there are no ads to protect, so a dev checkout, a CI run or a fresh
 *    deploy with an empty env is never walled off.
 * 2. The setup and admin surfaces stay open to operators. Locking the person
 *    who configures the deployment out of the configuration page would turn a
 *    revenue guard into a support incident.
 * 3. A wall needs evidence that something hid an element locally. A refused
 *    request, however often it repeats, is a network fact: a corporate proxy, a
 *    DNS filter, a school laptop, a captive portal and an ad-blocking DNS all
 *    refuse ad hosts while serving this page perfectly well. Repeating one kind
 *    of evidence does not make it a second kind, so network-only readings stay
 *    "suspicious" and never become a wall.
 * 4. No single probe is proof. Two bait boxes have to disappear, or one bait
 *    plus both ad hosts refusing, before the page accuses the browser.
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

/**
 * The hosts the probes ask for, one provider per entry.
 *
 * The first is the banner provider this app actually loads from, so a filter
 * that blocks our revenue is observed directly. The second is a widely targeted
 * ad host, which catches lists that special-case Google. They are two
 * independent readings: a single host being unreachable — DNS filtering one
 * name, a provider outage — is not a pattern.
 */
export const AD_PROBE_URLS = [
  "https://www.highperformanceformat.com/",
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
] as const;

/**
 * A same-origin request made beside the ad probes.
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

/**
 * How many independent ad hosts must refuse before a single hidden bait is
 * treated as corroboration rather than coincidence.
 */
export const AD_PROBE_MIN_REFUSED_HOSTS = 2;

/** How often the gate re-checks while the tab is open and the page is clear. */
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
  /**
   * What the probes last concluded. Only "blocked" — a local, cosmetic finding
   * — can become a wall; "suspicious" never does, no matter how many checks
   * agree with it.
   */
  verdict: AdVerdict;
  /**
   * How many consecutive checks reached "blocked". The wall appears once that
   * streak reaches AD_GATE_CONFIRMATIONS, so one frame of layout the filter
   * list has not reached yet cannot freeze the page.
   */
  confirmations?: number;
}): AdGateDecision {
  if (!input.adsConfigured) return { block: false, reason: "ads-off" };
  if (isExemptPath(input.pathname)) return { block: false, reason: "exempt" };

  if (input.verdict === "suspicious") {
    return { block: false, reason: "unconfirmed" };
  }

  if (input.verdict !== "blocked") return { block: false, reason: "clear" };

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
  /** How many of AD_PROBE_CLASSES a filter hid. Zero when the canary hid too. */
  hiddenBaits: number;
  /**
   * Whether the neutral box beside the baits was hidden as well. When it was,
   * the hiding was not ad-specific — a global rule, an extension tidying the
   * DOM, or the probe stage itself collapsing — and the reading proves nothing.
   */
  canaryHidden: boolean;
  /** Ad hosts that refused the request outright. A timeout is not a refusal. */
  refusedAdRequests: number;
  /** How many ad hosts were probed. */
  adRequests: number;
  control: ProbeAnswer;
};

/** What the probes add up to, before confirmation. */
export type AdVerdict = "clear" | "suspicious" | "blocked";

/**
 * Reads the evidence without over-claiming.
 *
 * - Both the page's own request and the probes failing is the network, not a
 *   filter, so it is clear. An offline browser, a captive portal and a proxy
 *   all land here.
 * - A hidden canary means the baits' disappearance is not about ads, so it is
 *   clear whatever else was observed.
 * - Two hidden baits are a cosmetic filter on their own, whatever the network
 *   was doing at the time: the hiding happened locally and needs no request.
 * - One hidden bait plus both ad hosts refusing is two independent signals,
 *   and the two together are enough.
 * - A refused request without a local signal stays "suspicious" for good. The
 *   gate cannot tell a blocker from a filtered network, and a reader has no way
 *   to argue with a wall.
 * - A slow ad request is a slow ad request. A timeout the browser aborted is
 *   not a refusal, so it is not counted either way.
 */
export function adBlockVerdict(evidence: AdEvidence): AdVerdict {
  if (evidence.control !== "ok") return "clear";
  if (evidence.canaryHidden) return "clear";

  if (evidence.hiddenBaits >= AD_PROBE_MIN_HIDDEN_BAITS) return "blocked";

  if (
    evidence.hiddenBaits >= 1 &&
    evidence.refusedAdRequests >= AD_PROBE_MIN_REFUSED_HOSTS
  ) {
    return "blocked";
  }

  if (evidence.refusedAdRequests > 0) return "suspicious";
  if (evidence.hiddenBaits >= 1) return "suspicious";

  return "clear";
}
