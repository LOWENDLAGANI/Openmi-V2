import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import { CommandPalette } from "@/components/CommandPalette";
import { NavProgress } from "@/components/NavProgress";
import "./globals.css";

/**
 * Type is the operating system's own face.
 *
 * The reference interface ships no webfont, which is why it reads as a native
 * app on every platform and why nothing reflows when a download finishes. The
 * stacks live in app/globals.css so one file owns the typography.
 */

export const metadata: Metadata = {
  title: "openmi — your repository, with a reviewer built in",
  description:
    "Connect GitHub, pick a repository, and chat with a model that reads the code and proposes edits. Nothing is pushed until you approve.",
  applicationName: "Openmi",
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
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("openmi-theme");if(t!=="paper"&&t!=="dark"&&t!=="ink")t="paper";var d=document.documentElement;d.classList.remove("light","dark","ink");if(t!=="paper")d.classList.add(t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="app-surface min-h-dvh bg-canvas text-body antialiased">
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <CommandPalette />
        {children}
      </body>
    </html>
  );
}
