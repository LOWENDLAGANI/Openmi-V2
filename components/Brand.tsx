import { OpenmiMark } from "@/components/OpenmiMark";

/**
 * The brand mark. Server component with no client handlers so it stays safe
 * inside navigation links.
 */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <OpenmiMark size={compact ? 18 : 20} />
      <span className="text-[16px] font-medium leading-none tracking-[-0.028em] text-hi">
        Openmi
      </span>
    </span>
  );
}
