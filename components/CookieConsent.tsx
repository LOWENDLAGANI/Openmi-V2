"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

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
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-card/95 px-4 py-3 backdrop-blur sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12.5px] leading-relaxed text-mid">
          Openmi uses an essential session cookie to keep you signed in, and a
          functional cookie to remember your region. Banner advertising is
          served by Adsterra and is loaded only if you accept; it may set its own
          cookies. Read the{" "}
          <Link
            href="/privacy#cookies"
            className="text-accent-text underline-offset-2 hover:underline"
          >
            cookie section
          </Link>{" "}
          of the Privacy Policy for the full list.
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