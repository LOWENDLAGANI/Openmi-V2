"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A thin bar that appears the instant a link is clicked.
 *
 * Most routes here are dynamic and read GitHub or Postgres before they render,
 * so the old page can sit on screen for a second or two after a click with no
 * sign the click landed. This listens for same-origin anchor clicks and shows a
 * bar until the URL changes. It is decorative feedback, not a loading
 * guarantee: if a navigation is cancelled by the browser, it clears itself.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, setPending] = useState(false);
  const timeout = useRef<number | null>(null);

  useEffect(() => {
    function stop() {
      setPending(false);
      if (timeout.current !== null) {
        window.clearTimeout(timeout.current);
        timeout.current = null;
      }
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }

      if (/^https?:\/\//i.test(href) && !href.startsWith(window.location.origin)) {
        return;
      }

      // A link to where we already are does not navigate; no bar, no lie.
      const destination = new URL(href, window.location.href);
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return;
      }

      setPending(true);
      if (timeout.current !== null) window.clearTimeout(timeout.current);
      // A refused or cancelled navigation must not leave a bar stuck forever.
      timeout.current = window.setTimeout(stop, 8_000);
    }

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      if (timeout.current !== null) window.clearTimeout(timeout.current);
    };
  }, []);

  useEffect(() => {
    setPending(false);
    if (timeout.current !== null) {
      window.clearTimeout(timeout.current);
      timeout.current = null;
    }
  }, [pathname, search]);

  if (!pending) return null;

  return (
    <div
      role="progressbar"
      aria-label="Loading the next page"
      aria-valuetext="Loading"
      className="nav-progress"
    />
  );
}
