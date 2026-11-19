import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import { Fraunces, Instrument_Sans } from "next/font/google";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz"],
});

/**
 * The landing page's text face.
 *
 * The app keeps the operating system's own face so it reads as a native
 * window; the front door gets a grotesque with a little more character, which
 * is what stops a marketing page looking like a settings screen. One extra
 * file, one variable, and only `.lp` uses it.
 */
const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

import { AdBlockGate } from "@/components/AdBlockGate";
import { guestEnabled } from "@/lib/guest";
import { CookieConsent } from "@/components/CookieConsent";
import { CommandPalette } from "@/components/CommandPalette";
import { NavProgress } from "@/components/NavProgress";
import { ServiceWorker } from "@/components/ServiceWorker";
import {
  SITE_DESCRIPTION,
  SITE_LOCALE,
  SITE_NAME,
  SITE_TITLE,
  siteUrl,
} from "@/lib/seo";
import "./globals.css";

/**
 * Type is the operating system's own face.
 *
 * The reference interface ships no webfont, which is why it reads as a native
 * app on every platform and why nothing reflows when a download finishes. The
 * stacks live in app/globals.css so one file owns the typography.
 */

/**
 * The document's own description, inherited by every page that does not write
 * one. `metadataBase` is what makes that inheritance safe: without it Next warns
 * on every relative URL and social scrapers resolve them against nothing, so a
 * page's `openGraph.images` or canonical link becomes a local path in a crawler's
 * log instead of a URL.
 *
 * A page stays out of the index by overriding `robots` — /admin, /setup, /banned
 * and /account/delete do — rather than by being told so here.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // A snippet is the whole result for a page like this one: letting Google
      // use all of it, and a large thumbnail, is the difference between a
      // listing that explains the product and a truncated line of it.
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: SITE_LOCALE,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  // `summary` rather than `summary_large_image`: there is no social card image,
  // and a large-image card with nothing in it is a grey rectangle.
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Openmi",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8f9fa",
};

/**
 * The theme is a class on <html>, resolved before the first paint so a reader
 * who chose Carbon or Ink never sees a frame of the paper canvas. No class means
 * paper, the default; "paper", "dark" and "ink" are the only values stored.
 *
 * The script is a static file in public/, not an inline string rendered with
 * dangerouslySetInnerHTML: a render-blocking tag in <head> still runs before
 * the first paint, and the document ends up with no inline script for a scan to
 * report. public/theme-boot.js owns the logic and the storage key.
 */

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="/theme-boot.js" />
      </head>
      <body
        className={`${fraunces.variable} ${instrument.variable} app-surface min-h-dvh bg-canvas text-body antialiased`}
      >
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <CommandPalette />
        <AdBlockGate />
        {children}
        {guestEnabled() && (
          <div className="pointer-events-none fixed inset-x-0 top-16 z-[95] flex justify-center">
            <span className="rounded-full border border-warn/40 bg-warn-bg px-3 py-1 text-[11px] text-warn shadow-[0_4px_14px_rgba(0,0,0,0.12)]">
              Guest preview — nothing is saved
            </span>
          </div>
        )}
        <ServiceWorker />
        <CookieConsent />
      </body>
    </html>
  );
}
