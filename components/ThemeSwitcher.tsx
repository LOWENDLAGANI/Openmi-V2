"use client";

import { useEffect, useState } from "react";

/**
 * The three themes, as a class on <html>.
 *
 * The value is read once on mount — never during render — so the server and the
 * first client render agree. `localStorage` is the only store; the bootstrap
 * script in the root layout applies it before paint.
 */
const THEMES = [
  { id: "dark", label: "Night", swatch: "#6ec294" },
  { id: "light", label: "Paper", swatch: "#0066ff" },
  { id: "ink", label: "Ink", swatch: "#a09ad8" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

function isTheme(value: string | null): value is ThemeId {
  return value === "dark" || value === "light" || value === "ink";
}

export function ThemeSwitcher({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeId>("dark");

  useEffect(() => {
    const saved = window.localStorage.getItem("openmi-theme");
    if (isTheme(saved)) setTheme(saved);
  }, []);

  function apply(next: ThemeId) {
    setTheme(next);
    try {
      window.localStorage.setItem("openmi-theme", next);
    } catch {
      // A private-mode storage refusal must not break the switch.
    }

    const root = document.documentElement;
    root.classList.remove("dark", "light", "ink");
    root.classList.add(next);
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className={`inline-flex items-center gap-1 rounded-full border border-line bg-card p-1 ${className}`}
    >
      {THEMES.map((option) => {
        const active = option.id === theme;

        return (
          <button
            key={option.id}
            type="button"
            onClick={() => apply(option.id)}
            aria-pressed={active}
            title={`${option.label} theme`}
            className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[10.5px] transition-colors ${
              active
                ? "bg-elevated text-hi"
                : "text-low hover:bg-hover hover:text-hi"
            }`}
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full border border-line-strong"
              style={{ backgroundColor: option.swatch }}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
