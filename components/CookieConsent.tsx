"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { readConsent, writeConsent, type ConsentChoice } from "@/lib/consent";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (readConsent() === null) setVisible(true);
  }, []);

  if (!visible) return null;

  const decide = (value: ConsentChoice) => {
    writeConsent(value);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-4xl rounded-xl border border-line-strong bg-card/95 p-4 shadow-[0_18px_48px_rgba(0,0,0,0.22)] backdrop-blur-md sm:inset-x-6 sm:bottom-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-[12.5px] leading-relaxed text-mid">
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
        <div className="flex shrink-0 items-center gap-2">
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
