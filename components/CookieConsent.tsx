"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { readConsent, writeConsent, type ConsentChoice } from "@/lib/consent";

/**
 * The consent bar is docked, not floated.
 *
 * It used to hang over the bottom of every page, which put it on top of the
 * composer, the receipt form, the pricing table and the delete-account card.
 * Now the bar measures itself into `--consent-space`, the document reserves
 * that height as bottom padding (app/globals.css) and a full-height app shell
 * subtracts it from its own height (.consent-aware-viewport). The space the bar
 * takes is space nothing else is drawn in.
 *
 * A page whose reader cannot act on the question — a 404, a suspended account —
 * renders an element marked `data-consent-scope="none"` and the bar stays away.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (document.querySelector('[data-consent-scope="none"]')) return;
    if (readConsent() === null) setVisible(true);
  }, []);

  useEffect(() => {
    if (!visible) return;

    const root = document.documentElement;

    const publish = () => {
      const height = barRef.current?.offsetHeight ?? 0;
      root.style.setProperty("--consent-space", `${height}px`);
    };

    publish();
    root.dataset.consent = "open";

    // The bar wraps to two or three lines on a narrow screen and to one on a
    // desktop; the reservation has to follow it, not guess a constant.
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(publish) : null;
    if (barRef.current && observer) observer.observe(barRef.current);
    window.addEventListener("resize", publish);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", publish);
      root.style.removeProperty("--consent-space");
      delete root.dataset.consent;
    };
  }, [visible]);

  if (!visible) return null;

  const decide = (value: ConsentChoice) => {
    writeConsent(value);
    setVisible(false);
  };

  return (
    <div
      ref={barRef}
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line-strong bg-card/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_rgba(0,0,0,0.14)] backdrop-blur-md sm:px-6"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="max-w-3xl text-[12.5px] leading-relaxed text-mid">
          Openmi uses an essential session cookie to keep you signed in and a
          functional cookie for your selected region. Banner advertising by
          Adsterra loads only if you accept. Read the{" "}
          <Link
            href="/privacy#cookies"
            className="font-medium text-accent-text underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            cookie section
          </Link>{" "}
          of the Privacy Policy for details.
        </p>
        <div className="flex shrink-0 items-center gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => decide("declined")}
            className="btn px-3.5 py-1.5 text-[12px]"
          >
            Decline ads
          </button>
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="btn btn-primary px-3.5 py-1.5 text-[12px]"
          >
            Accept ads
          </button>
        </div>
      </div>
    </div>
  );
}
