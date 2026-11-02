export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5 shrink-0 text-accent"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 15 12 7l8 8" />
        <path d="M4 20 12 12l8 8" opacity="0.45" />
      </svg>
      <span className="text-[17px] font-semibold leading-none tracking-[-0.03em] text-hi">
        openmi
      </span>
      {!compact && (
        <span className="eyebrow ml-1 hidden sm:inline">review before push</span>
      )}
    </span>
  );
}
