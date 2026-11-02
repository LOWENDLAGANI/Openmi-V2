const TONES = {
  ok: "border-accent/40 bg-accent-soft text-accent",
  missing: "border-danger/40 bg-danger/10 text-danger",
  optional: "border-line bg-chip text-mid",
  pending: "border-warn/40 bg-warn/10 text-warn",
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
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
