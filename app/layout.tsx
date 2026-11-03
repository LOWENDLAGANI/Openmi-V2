import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";

import { CommandPalette } from "@/components/CommandPalette";
import { NavProgress } from "@/components/NavProgress";
import "./globals.css";

/**
 * One grotesk for everything, one mono for the labels.
 *
 * Inter Tight is the closest freely available match to the tight neo-grotesk the
 * brand was drawn against: a single face carries the display headline and the
 * body copy, so the page has one voice instead of a headline font and a body
 * font that argue. The mono is only for metadata — eyebrows, paths, code.
 */
const sans = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-openmi-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-openmi-mono",
  display: "swap",
});

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
  themeColor: "#f4f1e9",
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
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
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
