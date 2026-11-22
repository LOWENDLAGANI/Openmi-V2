import { OpenmiMark } from "@/components/OpenmiMark";

/**
 * The brand mark. Server component with no client handlers so it stays safe
 * inside navigation links.
 */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <OpenmiMark size={20} />
      <span className="text-[15.5px] font-semibold leading-none tracking-[-0.03em] text-hi">
        Openmi
      </span>
      {!compact && (
        <span className="hidden rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] font-medium text-low sm:inline">
          repo agent
        </span>
      )}
    </span>
  );
}
