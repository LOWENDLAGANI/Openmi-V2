"use client";

import { REASONING_EFFORTS, type ReasoningEffort } from "@/lib/models";

/**
 * Thinking effort, for the model that takes one.
 *
 * Three settings rather than a slider: the provider accepts exactly these, and a
 * control that looked continuous would be lying about what it sends. `Fast` is
 * not a smaller answer — it turns thinking off, so the first token is the answer
 * instead of the start of a chain of thought.
 *
 * The group is a radio group, so a screen reader announces the current level and
 * the arrows walk the three, which is the same shape the model picker uses.
 */
export function EffortMenu({
  value,
  onChange,
}: {
  value: ReasoningEffort;
  onChange: (effort: ReasoningEffort) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Thinking effort"
      className="flex shrink-0 items-center rounded-full border border-line bg-raised p-0.5"
    >
      {REASONING_EFFORTS.map((option) => {
        const active = option.id === value;

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.blurb}
            onClick={() => onChange(option.id)}
            className={`rounded-full px-1.5 py-0.5 text-[10px] transition-colors ${
              active
                ? "bg-elevated font-medium text-hi"
                : "text-low hover:text-hi"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
