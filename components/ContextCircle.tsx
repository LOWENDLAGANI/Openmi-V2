"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The context budget as one ring.
 *
 * The number that matters before a turn is how much of the repository context
 * the last request actually carried, and a ring shows "nearly full" faster than
 * a fraction does. The ring is decoration over the exact figure: the popover
 * repeats the characters used against the characters allowed, and lists the
 * server's own notes about what was trimmed. No trim is ever invented here —
 * the notes come from the same object the request was assembled from.
 */
export function ContextCircle({
  usedChars,
  budgetChars,
  notes,
}: {
  usedChars: number;
  budgetChars: number;
  notes: string[];
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);

  const ratio = budgetChars > 0 ? Math.min(Math.max(usedChars / budgetChars, 0), 1) : 0;
  const percent = Math.round(ratio * 100);

  const size = 30;
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // A click anywhere else, or Escape, closes the panel. It is a detail view,
  // not a modal, so it never traps focus.
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

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`Repository context: ${percent}% of the ${budgetChars.toLocaleString()} character budget used`}
        title={`${usedChars.toLocaleString()} of ${budgetChars.toLocaleString()} characters of repository context`}
        className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-card hover:border-line-strong"
      >
        <span className="relative grid place-items-center">
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox={`0 0 ${size} ${size}`}
            width={size}
            height={size}
            className="-rotate-90"
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--line-strong)"
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - ratio)}
              style={{ transition: "stroke-dashoffset 320ms ease-out" }}
            />
          </svg>
          <span className="absolute font-mono text-[9px] leading-none text-mid">
            {percent}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="group"
          aria-label="Context budget"
          className="fade-in absolute right-0 top-full z-40 mt-2 w-64 rounded-2xl border border-line-strong bg-card p-3.5 shadow-[0_18px_44px_rgba(22,18,12,0.18)]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="eyebrow">context budget</p>
            <p className="font-mono text-[10px] text-low">{percent}% used</p>
          </div>

          <p className="mt-2 font-mono text-[11.5px] text-hi">
            {usedChars.toLocaleString()}
            <span className="text-low"> / {budgetChars.toLocaleString()} chars</span>
          </p>

          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-chip">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.max(percent, 1)}%` }}
            />
          </div>

          <p className="mt-2.5 text-[10.5px] leading-relaxed text-low">
            Characters of repository context sent with the last turn.
          </p>

          {notes.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
              {notes.map((note) => (
                <li
                  key={note}
                  className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-mid"
                >
                  <span
                    aria-hidden="true"
                    className="mt-[6px] size-1 shrink-0 rounded-full bg-warn"
                  />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 border-t border-line pt-2 text-[10px] leading-relaxed text-low">
            The file you have open is never trimmed. If it fills the budget, it
            is kept and the notes say why nothing else was added.
          </p>
        </div>
      )}
    </div>
  );
}
