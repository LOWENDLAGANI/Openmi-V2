"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { COUNTRY_COOKIE } from "@/lib/billing/currency";

/**
 * The fallback half of country detection.
 *
 * A host without a geo header (a local build, a proxy that strips them) leaves
 * the server with no country. The browser always knows its own region tag, so it
 * writes `openmi-country` once and asks for one refresh. The server still
 * prefers the host's geo header, so this cannot override a real IP lookup — it
 * only fills the gap.
 */
export function CountryHint({ needed }: { needed: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!needed) return;
    if (document.cookie.includes(`${COUNTRY_COOKIE}=`)) return;

    const region = (navigator.language ?? "").split("-")[1];
    if (!region || !/^[A-Za-z]{2}$/.test(region)) return;

    document.cookie = `${COUNTRY_COOKIE}=${region.toUpperCase()}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [needed, router]);

  return null;
}
