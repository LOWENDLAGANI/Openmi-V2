import { OpenmiMark } from "@/components/OpenmiMark";

/**
 * The brand mark. Deliberately plain.
 *
 * This is used inside links (sidebar, headers, the landing page), so it stays a
 * server component with no pointer handlers and no layout beyond an inline
 * flex row. The hidden admin gesture lives on its own component on /about,
 * because a listener here made the mark grow inside those links and broke the
 * surrounding navigation.
 */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <OpenmiMark size={20} />
      <span className="text-[17px] font-semibold leading-none tracking-[-0.02em] text-hi">
        Openmi
      </span>
      {!compact && (
        <span className="eyebrow ml-0.5 hidden sm:inline">repo agent</span>
      )}
    </span>
  );
}
