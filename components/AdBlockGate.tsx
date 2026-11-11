"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AD_GATE_RECHECK_MS,
  AD_PROBE_CLASSES,
  AD_PROBE_SIZE,
  AD_PROBE_TIMEOUT_MS,
  AD_PROBE_URL,
  decideAdGate,
  isProbeHidden,
} from "@/lib/adblock";
import { adConfig } from "@/lib/ads";

/**
 * Detects a hidden bait box, or a refused request to an ad host.
 *
 * The bait stage sits off the left edge at a real 300×250, so a cosmetic filter
 * that hides `.adsbox` and friends leaves it with a zero box. The stage is
 * removed in the same tick, before anything can paint.
 */
function probeCosmetic(): boolean {
  if (typeof document === "undefined" || !document.body) return false;

  const stage = document.createElement("div");
  stage.setAttribute("aria-hidden", "true");
  stage.style.cssText =
    "position:fixed;top:0;left:-10000px;width:1px;height:1px;overflow:hidden;pointer-events:none";

  const baits = AD_PROBE_CLASSES.map((name) => {
    const bait = document.createElement("div");
    bait.className = `${name} ads ad-slot`;
    bait.style.width = `${AD_PROBE_SIZE.width}px`;
    bait.style.height = `${AD_PROBE_SIZE.height}px`;
    stage.appendChild(bait);
    return bait;
  });

  document.body.appendChild(stage);

  const hidden = baits.some((bait) => {
    const box = bait.getBoundingClientRect();
    const style = window.getComputedStyle(bait);

    return isProbeHidden({
      width: box.width,
      height: box.height,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
    });
  });

  stage.remove();
  return hidden;
}

/**
 * A blocked request is evidence; a slow one is not. A timeout answers "no
 * answer", which is treated as clear so a bad connection never reads as a
 * blocker. An offline browser is likewise not accused.
 */
async function probeNetwork(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, AD_PROBE_TIMEOUT_MS);

  try {
    await fetch(AD_PROBE_URL, {
      mode: "no-cors",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    return false;
  } catch {
    return !timedOut;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * The blocking notice.
 *
 * It is mounted once in the root layout and covers the viewport when all three
 * conditions hold: an ad key is configured, the current path is a product
 * surface, and the browser is hiding the bait. It re-checks on an interval so
 * turning the blocker off clears it without a reload, and it never renders
 * during server rendering, so a wall cannot be baked into the HTML.
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

  const [detected, setDetected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [host, setHost] = useState("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const runProbe = useCallback(async (withNetwork: boolean) => {
    if (probeCosmetic()) return true;
    if (!withNetwork) return false;

    return probeNetwork();
  }, []);

  useEffect(() => {
    if (!adsConfigured) return;

    let alive = true;

    const check = async (withNetwork: boolean) => {
      const blocked = await runProbe(withNetwork);
      if (alive) setDetected(blocked);
    };

    void check(true);
    const timer = window.setInterval(
      () => void check(false),
      AD_GATE_RECHECK_MS
    );

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [adsConfigured, runProbe]);

  const decision = decideAdGate({ adsConfigured, pathname, detected });

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
      setDetected(await runProbe(true));
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
