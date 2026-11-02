const TONES = {
  ok: "border-accent/35 bg-accent-soft text-accent-text",
  missing: "border-danger/25 bg-danger/8 text-danger",
  optional: "border-line bg-chip text-mid",
  pending: "border-warn/25 bg-warn/8 text-warn",
} as const;

export type StatusTone = keyof typeof TONES;

export function StatusPill({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] ${TONES[tone]}`}
    >
      <span aria-hidden="true" className="size-1 rounded-full bg-current" />
      {children}
    </span>
  );
}
