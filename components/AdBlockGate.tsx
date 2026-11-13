"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AD_GATE_CONFIRMATIONS,
  AD_GATE_CONFIRM_MS,
  AD_GATE_RECHECK_MS,
  AD_PROBE_CLASSES,
  AD_PROBE_CONTROL_URL,
  AD_PROBE_SIZE,
  AD_PROBE_TIMEOUT_MS,
  AD_PROBE_URLS,
  adBlockVerdict,
  decideAdGate,
  isProbeHidden,
  type AdEvidence,
  type AdVerdict,
  type ProbeAnswer,
} from "@/lib/adblock";
import { adConfig } from "@/lib/ads";
import {
  adsAllowed,
  CONSENT_EVENT,
  readConsent,
  type ConsentChoice,
} from "@/lib/consent";

/**
 * Counts the bait boxes a filter removed.
 *
 * The stage sits off the left edge at a real 300×250, so a cosmetic filter that
 * hides `.adsbox` and friends leaves a zero box behind. The measurement waits
 * for two frames: a filter list can be injected after the element is appended,
 * and a box read in the same tick the element was created reports its size
 * either way. The count, not a boolean, is returned because one hidden div is
 * not a filter list.
 */
async function probeCosmetic(): Promise<{
  hiddenBaits: number;
  canaryHidden: boolean;
}> {
  if (typeof document === "undefined" || !document.body) {
    return { hiddenBaits: 0, canaryHidden: false };
  }

  const stage = document.createElement("div");
  stage.setAttribute("aria-hidden", "true");
  stage.style.cssText =
    "position:fixed;top:0;left:-10000px;width:1px;height:1px;overflow:hidden;pointer-events:none";

  const sized = () => {
    const element = document.createElement("div");
    element.style.width = `${AD_PROBE_SIZE.width}px`;
    element.style.height = `${AD_PROBE_SIZE.height}px`;
    stage.appendChild(element);
    return element;
  };

  // A neutral box in the same stage, with no ad class. If it disappears too,
  // whatever hid the baits was not an ad filter: a global "hide offscreen
  // elements" rule, an extension tidying the DOM, or the stage itself being
  // collapsed. That reading is thrown away rather than counted as evidence.
  const canary = sized();

  const baits = AD_PROBE_CLASSES.map((name) => {
    const bait = sized();
    bait.className = `${name} ads ad-slot`;
    return bait;
  });

  document.body.appendChild(stage);

  const isHidden = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const detached = element.getClientRects().length === 0;

    return isProbeHidden({
      width: detached ? 0 : box.width,
      height: detached ? 0 : box.height,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
    });
  };

  try {
    // A hidden tab never paints, so its frames never arrive; the timer is the
    // floor that keeps a probe from hanging forever.
    await Promise.race([
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      ),
      new Promise<void>((resolve) => window.setTimeout(resolve, 300)),
    ]);

    if (isHidden(canary)) return { hiddenBaits: 0, canaryHidden: true };

    return {
      hiddenBaits: baits.filter(isHidden).length,
      canaryHidden: false,
    };
  } catch {
    // A probe that cannot run is not a finding.
    return { hiddenBaits: 0, canaryHidden: true };
  } finally {
    stage.remove();
  }
}

/**
 * One request, and what came back.
 *
 * `no-cors` keeps the response opaque, which is all this needs: the question is
 * whether the request was allowed to leave, not what the host answered. A
 * timeout is its own answer, because a request the browser gave up on is not
 * the same thing as one a filter refused.
 */
async function probeUrl(url: string): Promise<ProbeAnswer> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, AD_PROBE_TIMEOUT_MS);

  try {
    await fetch(url, {
      mode: "no-cors",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    return "ok";
  } catch {
    return timedOut ? "timeout" : "failed";
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Both probes, side by side.
 *
 * The control request is what stops a bad connection from reading as a blocker:
 * the ad host and this site's own favicon are fetched at the same moment, and
 * only a refusal of the first while the second succeeds says anything about
 * ads. A browser that reports itself offline says nothing at all.
 */
async function collectEvidence(): Promise<AdEvidence> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      hiddenBaits: 0,
      canaryHidden: false,
      refusedAdRequests: 0,
      adRequests: 0,
      control: "timeout",
    };
  }

  const [cosmetic, adAnswers, control] = await Promise.all([
    probeCosmetic(),
    Promise.all(AD_PROBE_URLS.map((url) => probeUrl(url))),
    probeUrl(AD_PROBE_CONTROL_URL),
  ]);

  return {
    hiddenBaits: cosmetic.hiddenBaits,
    canaryHidden: cosmetic.canaryHidden,
    // A timeout means the browser gave up, not that a filter refused; it is
    // not counted as a refusal in either direction.
    refusedAdRequests: adAnswers.filter((answer) => answer === "failed").length,
    adRequests: adAnswers.length,
    control,
  };
}

/**
 * The blocking notice.
 *
 * It is mounted once in the root layout and covers the viewport only when an ad
 * key is configured, the current path is a product surface, and repeated checks
 * agree that the browser is hiding ads. It re-checks on a fast beat while it is
 * unsure and on a slow one once the page is clear, so turning a blocker off
 * clears the wall without a reload, and it never renders during server
 * rendering, so a wall cannot be baked into the HTML.
 */
export function AdBlockGate() {
  const pathname = usePathname() ?? "/";
  const adsConfigured = useMemo(
    () =>
      Boolean(
        adConfig("leaderboard") ||
          adConfig("mobile") ||
          adConfig("rectangle")
      ),
    []
  );

  const [consent, setConsent] = useState<ConsentChoice | null>(null);
  const [verdict, setVerdict] = useState<AdVerdict>("clear");
  const [confirmations, setConfirmations] = useState(0);
  const [checking, setChecking] = useState(false);
  const [host, setHost] = useState("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const sync = () => setConsent(readConsent());
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(CONSENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // A reader who declined receives no ads, so there is nothing for a blocker to
  // hide: the gate stays out of the way instead of demanding ads be allowed.
  const adsActive = adsConfigured && adsAllowed(consent);

  useEffect(() => {
    if (!adsActive) return;

    let alive = true;
    let timer = 0;
    let streak = 0;

    const schedule = (ms: number) => {
      if (!alive) return;
      timer = window.setTimeout(() => void run(), ms);
    };

    const run = async () => {
      // A background tab throttles timers and drops requests; that silence is
      // not evidence about ads, so it is skipped rather than counted as one.
      if (document.visibilityState !== "visible") {
        schedule(AD_GATE_RECHECK_MS);
        return;
      }

      let next: AdVerdict;
      try {
        next = adBlockVerdict(await collectEvidence());
      } catch {
        // A probe that could not run is not a finding; try again on the slow
        // beat instead of leaving the loop dead.
        schedule(AD_GATE_RECHECK_MS);
        return;
      }

      if (!alive) return;

      // Only a cosmetic finding counts toward the wall. A suspicious reading
      // keeps its own streak at zero, so repeating a refused request can never
      // add up to one.
      streak = next === "blocked" ? streak + 1 : 0;
      setVerdict(next);
      setConfirmations(streak);

      // A finding is confirmed on the fast beat, because the reader is about to
      // be interrupted; a clear page is re-checked slowly, because nothing is
      // waiting on it.
      schedule(
        next === "clear" ? AD_GATE_RECHECK_MS : AD_GATE_CONFIRM_MS
      );
    };

    void run();

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [adsActive]);

  const decision = decideAdGate({
    adsConfigured: adsActive,
    pathname,
    verdict,
    confirmations,
  });

  useEffect(() => {
    if (!decision.block) return;

    setHost(window.location.host);
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    buttonRef.current?.focus();

    return () => {
      root.style.overflow = previousOverflow;
    };
  }, [decision.block]);

  async function checkAgain() {
    setChecking(true);
    try {
      const next = adBlockVerdict(await collectEvidence());
      setVerdict(next);

      if (next === "blocked") {
        // The wall is already up: the reader asked for this check, so a
        // confirmed finding holds it instead of flashing the page.
        setConfirmations(AD_GATE_CONFIRMATIONS);
      } else {
        // Suspicious and clear both drop the wall: a refused request is not
        // something the reader can fix by arguing with their browser.
        setConfirmations(0);
      }
    } catch {
      // The probe did not run; the wall stays where it was.
    } finally {
      setChecking(false);
    }
  }

  if (!decision.block) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="adblock-title"
      aria-describedby="adblock-body"
      data-adblock-gate=""
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-canvas px-4 py-10"
    >
      <div className="w-full max-w-md rounded-3xl border border-line bg-card p-6 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
        <p className="eyebrow">advertisement check</p>

        <h2
          id="adblock-title"
          className="mt-2 text-[21px] font-semibold leading-tight tracking-[-0.02em] text-hi"
        >
          Openmi is paused because your ad blocker is on
        </h2>

        <p
          id="adblock-body"
          className="mt-3 text-[13.5px] leading-relaxed text-mid"
        >
          The banners under each page are what keep Openmi free to run. Your
          browser is hiding them, so the app stays closed until they are
          allowed.
        </p>

        <ol className="mt-4 space-y-2 text-[13px] leading-relaxed text-body">
          <li>
            1. Open your ad blocker, or the shield icon in your browser&apos;s
            address bar.
          </li>
          <li>
            2. Allow ads for {host ? <strong className="font-medium text-hi">{host}</strong> : "this site"}, then
            come back here.
          </li>
          <li>3. Press the button below. Reloading also works.</li>
        </ol>

        <button
          ref={buttonRef}
          type="button"
          onClick={checkAgain}
          disabled={checking}
          className="mt-5 w-full rounded-full bg-accent px-4 py-2.5 text-[13px] font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {checking ? "Checking…" : "I turned it off — check again"}
        </button>

        <p className="mt-3 text-center text-[11.5px] leading-relaxed text-low">
          The check runs in your browser. Nothing about you is sent to decide
          this.
        </p>
      </div>
    </div>
  );
}
