import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

import { AdBlockGate } from "@/components/AdBlockGate";
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
  twitter: {
    card: "summary_large_image",
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
  themeColor: "#fafafa",
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
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh bg-canvas text-body antialiased`}
      >
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <CommandPalette />
        <AdBlockGate />
        {children}
        <ServiceWorker />
        <CookieConsent />
      </body>
    </html>
  );
}
