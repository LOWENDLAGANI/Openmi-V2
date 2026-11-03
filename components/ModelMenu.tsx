"use client";

import { useEffect, useRef, useState } from "react";

import { MODEL_CATEGORIES, type ModelCapability } from "@/lib/models";

/**
 * The model picker.
 *
 * A native `<select>` cannot carry a description, a group heading and a disabled
 * reason without looking like a form control from another product. This is a
 * popover that opens upward out of the composer: grouped by capability, closed on
 * an outside pointer or Escape, and reachable from the keyboard (arrows move,
 * Enter chooses). It still knows nothing about providers — only the public name,
 * the blurb and whether a key exists.
 */
export function ModelMenu({
  models,
  value,
  onChange,
  disabled = false,
}: {
  models: ModelCapability[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);

  const current = models.find((model) => model.id === value) ?? models[0];

  useEffect(() => {
    if (!open) return;

    function onPointer(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /** Arrow keys walk the options; Enter is the button's own activation. */
  function onPanelKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();

    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="option"]:not(:disabled)'
      )
    );

    if (options.length === 0) return;

    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const target = options[(index + step + options.length) % options.length];
    target?.focus();
  }

  const groups = MODEL_CATEGORIES.map((category) => ({
    ...category,
    options: models.filter((model) => model.category === category.id),
  })).filter((group) => group.options.length > 0);

  return (
    <div ref={wrapper} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${current?.name ?? value}`}
        className="model-pill lift max-w-[10.5rem] disabled:opacity-50"
      >
        <span className="min-w-0 truncate text-[11px]">
          {current?.name ?? value}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={`size-3 shrink-0 text-low transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Model"
          onKeyDown={onPanelKey}
          className="animate-pop absolute bottom-full left-0 z-40 mb-1.5 max-h-[58vh] w-64 max-w-[calc(100vw-2.5rem)] overflow-y-auto rounded-2xl border border-line bg-card p-1.5 shadow-[0_24px_50px_rgba(0,0,0,0.22)]"
        >
          {groups.map((group) => (
            <div key={group.id} className="pb-1 last:pb-0">
              <p className="eyebrow px-2.5 pb-1 pt-1.5">{group.label}</p>

              {group.options.map((option) => {
                const available = option.available !== false;
                const active = option.id === value;

                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={!available}
                    onClick={() => {
                      onChange(option.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "bg-elevated text-hi"
                        : "text-body hover:bg-hover hover:text-hi"
                    } ${available ? "" : "opacity-45"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">
                        {option.name}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-low">
                        {available ? option.blurb : "Provider key missing"}
                      </span>
                    </span>

                    {active && (
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="mt-0.5 size-3.5 shrink-0 text-accent-text"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m5 12.5 4.5 4.5L19 7.5" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
