const TONES = {
  ok: "border-accent/30 bg-accent-soft text-accent-text",
  missing: "border-danger/30 bg-danger/8 text-danger",
  optional: "border-line bg-raised text-mid",
  pending: "border-warn/30 bg-warn/8 text-warn",
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
      className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium leading-tight ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
