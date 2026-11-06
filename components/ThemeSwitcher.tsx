"use client";

import { useEffect, useState } from "react";

/**
 * The three appearances, as a class on <html>.
 *
 * Light is the default and has no class of its own; Dark and Ink are `dark` and
 * `ink`. The ids stay `paper|dark|ink` because they are already written into
 * people's localStorage: renaming them would reset every saved appearance to
 * the default. Only the labels follow the reference. The value is read once on
 * mount — never during render — so the server and the first client render
 * agree. `localStorage` is the only store; the bootstrap script in the root
 * layout applies it before paint.
 */
const THEMES = [
  { id: "paper", label: "Light", swatch: "#0066ff", className: "" },
  { id: "dark", label: "Dark", swatch: "#6ec294", className: "dark" },
  { id: "ink", label: "Ink", swatch: "#a09ad8", className: "ink" },
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
  /** `icon` is one button that cycles the themes, for the sidebar's account bar. */
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

    return (
      <button
        type="button"
        onClick={() => apply(next.id)}
        aria-label={`Theme: ${current.label}. Switch to ${next.label}`}
        title={`Theme: ${current.label} · switch to ${next.label}`}
        className={`grid size-9 shrink-0 place-items-center rounded-full text-mid transition-colors hover:bg-hover hover:text-hi ${className}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <circle cx="12" cy="12" r="8.2" />
          <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4Z" fill="currentColor" stroke="none" />
        </svg>
      </button>
    );
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
