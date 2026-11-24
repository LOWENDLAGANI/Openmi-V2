"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { PRESENCE_HEARTBEAT_MS } from "@/lib/admin/presence-types";

const VISITOR_STORAGE_KEY = "openmi.visitorId";

function getVisitorId(): string {
  try {
    const existing = window.sessionStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;

    const generated =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

    window.sessionStorage.setItem(VISITOR_STORAGE_KEY, generated);
    return generated;
  } catch {
    return "";
  }
}

/**
 * Sends a quiet, same-origin heartbeat while the tab is visible so the /admin
 * live presence panel can show who is currently active and who was last on the
 * website.
 */
export function PresenceBeacon() {
  const pathname = usePathname() || "/";
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    const visitorId = getVisitorId();

    const ping = () => {
      if (document.visibilityState !== "visible") return;
      const currentPath = pathRef.current || "/";
      if (currentPath.startsWith("/api")) return;

      void fetch("/api/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: currentPath, visitorId }),
        keepalive: true,
      }).catch(() => {});
    };

    ping();

    const timer = window.setInterval(ping, PRESENCE_HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  return null;
}
