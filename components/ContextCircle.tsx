"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { estimateTokens } from "@/lib/context";

/**
 * Context budget donut indicator in the composer bar.
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

  const ratio =
    budgetChars > 0 ? Math.min(Math.max(usedChars / budgetChars, 0), 1) : 0;
  const percent = Math.round(ratio * 100);
  const full = percent >= 100;

  const usedTokens = estimateTokens(usedChars);
  const budgetTokens = estimateTokens(budgetChars);

  const size = 24;
  const stroke = 2.75;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const tone =
    full || percent >= 95
      ? "var(--danger)"
      : percent >= 70
        ? "var(--warn)"
        : "var(--accent)";

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
    <div ref={wrapper} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`Context: ${percent}% of about ${budgetTokens.toLocaleString()} tokens used`}
        title={`About ${usedTokens.toLocaleString()} of ${budgetTokens.toLocaleString()} tokens of repository context`}
        className="grid size-8 place-items-center rounded-lg border border-line bg-raised transition-colors hover:border-line-strong hover:bg-hover"
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
              stroke="var(--text-low)"
              strokeOpacity="0.2"
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={tone}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - ratio)}
              style={{ transition: "stroke-dashoffset 320ms ease-out" }}
            />
          </svg>
          <span className="absolute font-mono text-[8px] font-medium leading-none tabular-nums text-mid">
            {percent}
          </span>
        </span>
      </button>

      {open && (
        <div
          role="group"
          aria-label="Context breakdown"
          className="animate-pop absolute bottom-full right-0 z-40 mb-2 w-72 rounded-xl border border-line-strong bg-card p-3.5 shadow-[0_20px_48px_rgba(0,0,0,0.3)]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12px] font-medium text-hi">Context budget</p>
            <p className="font-mono text-[11px] tabular-nums text-low">
              {percent}% used
            </p>
          </div>

          <p className="mt-2 font-mono text-[12px] tabular-nums text-hi">
            ≈ {usedTokens.toLocaleString()}
            <span className="text-low"> / {budgetTokens.toLocaleString()} tokens</span>
          </p>

          <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-raised">
            <div
              className="h-full rounded-sm transition-[width] duration-300"
              style={{ width: `${Math.max(percent, 1)}%`, backgroundColor: tone }}
            />
          </div>

          <p className="mt-2.5 text-[11px] leading-relaxed text-low">
            Estimated tokens of repository context sent with the last turn at
            four characters per token.
          </p>

          {notes.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
              {notes.map((note) => (
                <li
                  key={note}
                  className="text-[11px] leading-relaxed text-warn"
                >
                  {note}
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 border-t border-line pt-2 text-[10.5px] leading-relaxed text-low">
            The file you have open is never trimmed. If it fills the budget, it
            is kept and the notes say why nothing else was added.
          </p>

          {full && (
            <Link
              href="/chat?new=1"
              onClick={() => setOpen(false)}
              className="btn btn-primary mt-2.5 w-full py-1.5 text-[12px]"
            >
              Start a new chat
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
