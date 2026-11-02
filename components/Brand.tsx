export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-lg border border-line bg-chip font-mono text-[13px] font-semibold text-accent"
      >
        O
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-hi">
        Openmi
        {!compact && (
          <span className="ml-2 hidden text-[11px] font-normal uppercase tracking-[0.14em] text-low sm:inline">
            review before push
          </span>
        )}
      </span>
    </span>
  );
}
