"use client";

import {
  BorderBeam,
  type BorderBeamColorVariant,
  type BorderBeamSize,
} from "border-beam";
import { useEffect, useState, type ReactNode } from "react";

/**
 * The Libraries.dev border beam, bound to this app's appearance.
 *
 * Two things need doing here, which is why this wrapper exists rather than a
 * direct import:
 *
 * 1. `border-beam` ships no `"use client"` directive, but it uses `useRef`,
 *    `useState` and `useEffect`. Importing it into a server component such as
 *    `app/page.tsx` would fail at render, so this file is the one client
 *    boundary and the page imports this instead.
 * 2. Its `theme` prop picks colours tuned for a dark or light surface, and this
 *    app keeps its appearance as a class on `<html>` (`dark` and `ink`, with no
 *    class for the default paper theme) rather than following the OS. The class
 *    is read after mount and followed with a `MutationObserver`, so switching
 *    the theme in the header re-colours the beam without a reload.
 *
 * The effect ships its own stylesheet and honours `prefers-reduced-motion`, so
 * there is nothing to import and no animation to disable by hand.
 */
export function Beam({
  children,
  size = "md",
  colorVariant = "colorful",
  strength = 0.7,
  active = true,
}: {
  children: ReactNode;
  size?: BorderBeamSize;
  colorVariant?: BorderBeamColorVariant;
  /** Glow intensity, 0–1. */
  strength?: number;
  active?: boolean;
}) {
  // The server and the first client render must agree, so this starts light and
  // is corrected on mount — the same shape `ThemeSwitcher` uses.
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;

    const read = () =>
      setTheme(
        root.classList.contains("dark") || root.classList.contains("ink")
          ? "dark"
          : "light"
      );

    read();

    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  return (
    <BorderBeam
      size={size}
      colorVariant={colorVariant}
      strength={strength}
      theme={theme}
      active={active}
    >
      {children}
    </BorderBeam>
  );
}
