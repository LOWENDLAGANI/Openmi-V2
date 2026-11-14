"use client";

import {
  BorderBeam,
  type BorderBeamColorVariant,
  type BorderBeamSize,
} from "border-beam";
import type { ReactNode } from "react";

import { useAppTheme } from "@/components/useAppTheme";

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
 *    app keeps its appearance as a class on `<html>` rather than following the
 *    OS. `useAppTheme` is the one place that translates the three appearances
 *    into that flag, and it follows a switch in the header without a reload.
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
  const theme = useAppTheme();

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
