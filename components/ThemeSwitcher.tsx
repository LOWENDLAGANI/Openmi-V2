"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The three appearances, applied as a class on <html>.
 *
 * The stored ids stay `paper | dark | ink` so existing `localStorage` entries
 * keep working seamlessly; `ink` now renders our Midnight Slate palette.
 */
const THEMES = [
  { id: "paper", label: "Light", swatch: "#eef0f3", className: "" },
  { id: "dark", label: "Dark", swatch: "#0b0c0e", className: "dark" },
  { id: "ink", label: "Slate", swatch: "#121923", className: "ink" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

function isTheme(value: string | null): value is ThemeId {
  return value === "paper" || value === "dark" || value === "ink";
}

export function ThemeSwitcher({
  className = "",
  variant = "segmented",
}: {
  className?: string;
  variant?: "segmented" | "icon";
}) {
  const [theme, setTheme] = useState<ThemeId>("paper");

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
    root.classList.remove("light", "dark", "ink");
    const option = THEMES.find((entry) => entry.id === next);
    if (option && option.className) root.classList.add(option.className);
  }

  if (variant === "icon") {
    const index = THEMES.findIndex((entry) => entry.id === theme);
    const current = THEMES[index] ?? THEMES[0];
    const next = THEMES[(index + 1) % THEMES.length];

    const Icon =
      current.id === "paper" ? Sun : current.id === "dark" ? Moon : Monitor;

    return (
      <button
        type="button"
        onClick={() => apply(next.id)}
        aria-label={`Theme: ${current.label}. Switch to ${next.label}`}
        title={`Theme: ${current.label} — switch to ${next.label}`}
        className={`grid size-8 shrink-0 place-items-center rounded-lg border border-transparent text-mid transition-colors hover:border-line hover:bg-hover hover:text-hi ${className}`}
      >
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5 ${className}`}
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
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
              active
                ? "bg-card text-hi shadow-[var(--card-shadow)]"
                : "text-low hover:text-hi"
            }`}
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-sm border border-line-strong"
              style={{ backgroundColor: option.swatch }}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
