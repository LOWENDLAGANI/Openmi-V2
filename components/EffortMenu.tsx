"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);

  const current =
    REASONING_EFFORTS.find((effort) => effort.id === value) ??
    REASONING_EFFORTS[0];

  useEffect(() => {
    if (!open) return;

    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        setPos({ bottom: window.innerHeight - rect.top + 8, left: rect.left });
      }
    };
    update();

    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
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
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Thinking effort: ${current?.label ?? value}`}
        className="model-pill max-w-[10.5rem] disabled:opacity-50"
      >
        {/* The same dial the reference uses for its thinking control: a clock
            with its orbit dots, so effort reads as time spent thinking. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="size-3.5 shrink-0 opacity-80"
        >
          <path d="M10.3857 2.50977C14.3486 2.71054 17.5 5.98724 17.5 10C17.5 14.1421 14.1421 17.5 10 17.5C5.85786 17.5 2.5 14.1421 2.5 10C2.5 9.72386 2.72386 9.5 3 9.5C3.27614 9.5 3.5 9.72386 3.5 10C3.5 13.5899 6.41015 16.5 10 16.5C13.5899 16.5 16.5 13.5899 16.5 10C16.5 6.5225 13.7691 3.68312 10.335 3.50879L10 3.5L9.89941 3.49023C9.67145 3.44371 9.5 3.24171 9.5 3C9.5 2.72386 9.72386 2.5 10 2.5L10.3857 2.50977ZM10 5.5C10.2761 5.5 10.5 5.72386 10.5 6V9.69043L13.2236 11.0527C13.4706 11.1762 13.5708 11.4766 13.4473 11.7236C13.3392 11.9397 13.0957 12.0435 12.8711 11.9834L12.7764 11.9473L9.77637 10.4473C9.60698 10.3626 9.5 10.1894 9.5 10V6C9.5 5.72386 9.72386 5.5 10 5.5ZM3.66211 6.94141C4.0273 6.94159 4.32303 7.23735 4.32324 7.60254C4.32324 7.96791 4.02743 8.26446 3.66211 8.26465C3.29663 8.26465 3 7.96802 3 7.60254C3.00021 7.23723 3.29676 6.94141 3.66211 6.94141ZM4.95605 4.29395C5.32146 4.29404 5.61719 4.59063 5.61719 4.95605C5.6171 5.3214 5.3214 5.61709 4.95605 5.61719C4.59063 5.61719 4.29403 5.32146 4.29395 4.95605C4.29395 4.59057 4.59057 4.29395 4.95605 4.29395ZM7.60254 3C7.96802 3 8.26465 3.29663 8.26465 3.66211C8.26446 4.02743 7.96791 4.32324 7.60254 4.32324C7.23736 4.32302 6.94159 4.0273 6.94141 3.66211C6.94141 3.29676 7.23724 3.00022 7.60254 3Z" />
        </svg>
        <span className="min-w-0 truncate text-[12px]">
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

      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="listbox"
            aria-label="Thinking effort"
            onKeyDown={onPanelKey}
            style={{
              position: "fixed",
              bottom: pos.bottom,
              left: pos.left,
              zIndex: 100,
            }}
            className="animate-pop max-h-[58vh] w-[264px] max-w-[calc(100vw-2.5rem)] overflow-y-auto rounded-2xl border border-line bg-card p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.22)]"
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
                        <span className="truncate text-[13px] font-semibold">
                          {option.label}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-low">
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
          </div>,
          document.body
        )}
    </div>
  );
}
