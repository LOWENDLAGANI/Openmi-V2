"use client";

import { useEffect, useState } from "react";

export type AppTheme = "light" | "dark";

/**
 * This app's appearance, as a light/dark flag.
 *
 * The Libraries.dev effects take a light-or-dark choice, while this app keeps
 * three appearances as a class on `<html>`: `dark` and `ink` are dark surfaces
 * and paper is the absence of a class. Reading it after mount and following it
 * with a `MutationObserver` means a switch in the header re-tunes the effect on
 * screen without a reload.
 *
 * The value starts light because the server and the first client render have to
 * agree — the bootstrap script in the root layout applies the saved theme before
 * paint, and this corrects to it immediately after mount.
 */
export function useAppTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>("light");

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

  return theme;
}
