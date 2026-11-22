"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { REASONING_EFFORTS, type ReasoningEffort } from "@/lib/models";

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
    options[targetIndex]?.focus();
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
        <span className="min-w-0 truncate text-[12px]">
          {current?.label ?? value}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-3.5 shrink-0 text-low transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={1.75}
        />
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
            className="animate-pop max-h-[58vh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-line-strong bg-card p-1.5 shadow-[0_24px_56px_rgba(0,0,0,0.28)]"
          >
            <div className="pb-1 last:pb-0">
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-low">
                Thinking effort
              </p>

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
                    className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "bg-elevated text-hi"
                        : "text-body hover:bg-hover hover:text-hi"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-low">
                        {option.blurb}
                      </span>
                    </span>

                    {active && (
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 size-3.5 shrink-0 text-accent-text"
                        strokeWidth={2.25}
                      />
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
