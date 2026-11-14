"use client";

import { useEffect, useState } from "react";

/**
 * The install control, on the browser's terms.
 *
 * `beforeinstallprompt` fires only when the browser has decided the app is
 * installable (manifest, icons, a service worker, an origin it trusts). Until
 * then this renders nothing: an "Install" button that cannot install is worse
 * than no button, and a fake one is the classic gimmick this product avoids.
 */

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Keep the event so our own control can fire it on a click.
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };

    const onInstalled = () => setPrompt(null);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!prompt) return null;

  return (
    <button
      type="button"
      aria-label="Install Openmi"
      title="Install Openmi"
      className="rail-icon grid size-9 place-items-center rounded-full"
      onClick={() => {
        void prompt
          .prompt()
          .catch(() => {
            // A dismissed or expired prompt is not an error state.
          })
          .finally(() => setPrompt(null));
      }}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        className="size-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 4v10M8 10.5 12 14.5l4-4" />
        <path d="M5 17.5v1.4A1.6 1.6 0 0 0 6.6 20.5h10.8a1.6 1.6 0 0 0 1.6-1.6v-1.4" />
      </svg>
    </button>
  );
}
