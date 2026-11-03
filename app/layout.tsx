import type { Metadata, Viewport } from "next";
import { Suspense } from "react";

import { CommandPalette } from "@/components/CommandPalette";
import { NavProgress } from "@/components/NavProgress";
import "./globals.css";

export const metadata: Metadata = {
  title: "Openmi — your repository, with a reviewer built in",
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
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1310",
};

/**
 * The theme is a class on <html>, resolved before the first paint so a reader
 * who chose Paper never sees a frame of the night canvas. No class means the
 * default dark theme; the three names are the only values stored.
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("openmi-theme");if(t!=="light"&&t!=="ink"&&t!=="dark")t="dark";var d=document.documentElement;d.classList.remove("dark","light","ink");d.classList.add(t);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
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
