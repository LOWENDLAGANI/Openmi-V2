"use client";

import { useEffect, useRef, useState } from "react";

import { REASONING_EFFORTS, type ReasoningEffort } from "@/lib/models";

/**
 * Thinking effort, for the model that takes one.
 *
 * Three settings rather than a slider: the provider accepts exactly these, and a
 * control that looked continuous would be lying about what it sends. `Fast` is
 * not a smaller answer — it turns thinking off, so the first token is the answer
 * instead of the start of a chain of thought.
 *
 * This is a popover like the model picker: grouped presentation does not apply
 * (there is only one group), but the same open/close, keyboard and selection
 * behaviour keeps the two controls feeling like one family.
 */
export function EffortMenu({
  value,
  onChange,
  disabled = false,
}: {
  value: ReasoningEffort;
  onChange: (effort: ReasoningEffort) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);

  const current =
    REASONING_EFFORTS.find((effort) => effort.id === value) ??
    REASONING_EFFORTS[0];

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
    const targetIndex =
      index === -1
        ? step === 1
          ? 0
          : options.length - 1
        : (index + step + options.length) % options.length;
    const target = options[targetIndex];
    target?.focus();
  }

  return (
    <div ref={wrapper} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Thinking effort: ${current?.label ?? value}`}
        className="model-pill lift max-w-[10.5rem] disabled:opacity-50"
      >
        <span className="min-w-0 truncate text-[11px]">
          {current?.label ?? value}
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
          aria-label="Thinking effort"
          onKeyDown={onPanelKey}
          className="animate-pop absolute bottom-full left-0 z-40 mb-1.5 max-h-[58vh] w-64 max-w-[calc(100vw-2.5rem)] overflow-y-auto rounded-2xl border border-line bg-card p-1.5 shadow-[0_24px_50px_rgba(0,0,0,0.22)]"
        >
          <div className="pb-1 last:pb-0">
            <p className="eyebrow px-2.5 pb-1 pt-1.5">Thinking effort</p>

            {REASONING_EFFORTS.map((option) => {
              const active = option.id === value;

              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={option.blurb}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${
                    active
                      ? "bg-elevated text-hi"
                      : "text-body hover:bg-hover hover:text-hi"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium">
                          {option.label}
                        </span>
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-low">
                      {option.blurb}
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
        </div>
      )}
    </div>
  );
}
