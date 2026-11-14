"use client";

import { useEffect } from "react";

/**
 * Registers the static-asset service worker, in production only.
 *
 * `next dev` compiles chunks on demand and a cached one would survive a rebuild,
 * so development never registers it. There is no update prompt: `sw.js` calls
 * `skipWaiting` and `clients.claim`, and it only ever holds immutable build
 * output, so the worst a stale cache can do is serve an old image.
 *
 * Failure is silent by design — a browser that refuses service workers should
 * simply keep loading the app from the network.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // No worker is a working app; nothing to report to the reader.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
