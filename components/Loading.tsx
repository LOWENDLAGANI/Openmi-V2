import type { ReactNode } from "react";

import { OpenmiMark } from "@/components/OpenmiMark";

/**
 * The loading vocabulary: one spinner, one status bar, used everywhere.
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

export function ThinkingPill({
  label,
  icon,
  className = "",
}: {
  label: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex w-fit max-w-full items-center gap-2 rounded-lg border border-line bg-raised px-3 py-1.5 text-[12px] font-medium text-mid ${className}`}
    >
      {icon ?? <Spinner size={14} className="text-accent-text" />}
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}
