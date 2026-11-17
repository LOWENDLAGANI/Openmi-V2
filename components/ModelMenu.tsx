"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  paidActive = false,
  disabled = false,
}: {
  models: ModelCapability[];
  value: string;
  onChange: (id: string) => void;
  /** The picker shows what a pass unlocks; it is not what enforces it. */
  paidActive?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null);

  const current = models.find((model) => model.id === value) ?? models[0];

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

  const groups = MODEL_CATEGORIES.map((category) => ({
    ...category,
    options: models.filter((model) => model.category === category.id),
  })).filter((group) => group.options.length > 0);

  return (
    <div className="relative min-w-0">
      <button
        ref={buttonRef}
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
        {current?.paidOnly === true && !paidActive && (
          <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[8px] text-accent-text">
            paid
          </span>
        )}
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
            aria-label="Model"
            onKeyDown={onPanelKey}
            style={{
              position: "fixed",
              bottom: pos.bottom,
              left: pos.left,
              zIndex: 100,
            }}
            className="animate-pop max-h-[58vh] w-64 max-w-[calc(100vw-2.5rem)] overflow-y-auto rounded-2xl border border-line bg-card p-1.5 shadow-[0_24px_50px_rgba(0,0,0,0.22)]"
          >
            {groups.map((group) => (
              <div key={group.id} className="pb-1 last:pb-0">
                <p className="eyebrow px-2.5 pb-1 pt-1.5">{group.label}</p>

                {group.options.map((option) => {
                  const available = option.available !== false;
                  const locked = option.paidOnly === true && !paidActive;
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
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[12px] font-medium">
                            {option.name}
                          </span>
                          {locked && (
                            <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[8px] text-accent-text">
                              paid
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-snug text-low">
                          {locked
                            ? "Paid passes only"
                            : available
                              ? option.blurb
                              : "Provider key missing"}
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
          </div>,
          document.body
        )}
    </div>
  );
}
