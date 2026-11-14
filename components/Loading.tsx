import type { ReactNode } from "react";

import { OpenmiMark } from "@/components/OpenmiMark";

/**
 * The loading vocabulary: one spinner, one pill, used everywhere.
 *
 * The spinner is the brand mark on its axis rather than a generic ring, so a
 * wait looks like part of the product. It is decoration only: the text beside
 * it carries the meaning, and the global reduced-motion rule stops the
 * rotation for anyone who asks for that.
 */
export function Spinner({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`spinner inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size }}
    >
      <OpenmiMark size={size} />
    </span>
  );
}

/**
 * The "still working" pill. The animated dots are hidden from assistive tech;
 * the label is announced once, politely, instead of on every repaint.
 */
export function ThinkingPill({
  label,
  icon,
  className = "",
}: {
  label: string;
  /** The mark beside the label; the brand spinner unless a caller supplies one. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex w-fit max-w-full items-center gap-2.5 rounded-full bg-accent-soft px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-accent-text ${className}`}
    >
      {icon ?? <Spinner size={15} className="text-accent-text" />}
      <span className="min-w-0 truncate">{label}</span>
      <span className="computing inline-flex gap-[2px]" aria-hidden="true">
        <span>·</span>
        <span>·</span>
        <span>·</span>
      </span>
    </div>
  );
}
