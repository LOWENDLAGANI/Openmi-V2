"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

const STORAGE_KEY = "openmi-cookie-consent";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // Storage may be unavailable (private mode); show the banner anyway.
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const decide = (value: "accepted" | "declined") => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Ignore: the banner simply reappears next visit.
    }
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
          Openmi uses an essential session cookie to keep you signed in. If
          advertising is enabled, optional advertising cookies may also be set.
          See the{" "}
          <Link
            href="/privacy"
            className="text-accent-text underline-offset-2 hover:underline"
          >
            Privacy Policy
          </Link>{" "}
          for details.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => decide("declined")}
            className="btn px-3.5 py-1.5 text-[12px]"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="btn btn-primary px-3.5 py-1.5 text-[12px]"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}