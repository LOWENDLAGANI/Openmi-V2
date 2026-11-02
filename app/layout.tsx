import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Openmi — your repository, with a reviewer built in",
  description:
    "Connect GitHub, pick a repository, and chat with a model that reads the code and proposes edits. Nothing is pushed until you approve.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-canvas text-body antialiased">{children}</body>
    </html>
  );
}
