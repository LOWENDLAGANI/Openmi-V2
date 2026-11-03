import { Spinner } from "@/components/Loading";

/**
 * The shape of a page while the server is still answering.
 *
 * These pages make network calls before they can render anything (GitHub,
 * Supabase, provider probes), so a skeleton that matches the real layout is the
 * difference between "slow" and "broken". The shimmer is decoration: the global
 * reduced-motion rule stops it.
 */
export function PageSkeleton({
  rows = 5,
  label = "loading",
  width = "max-w-4xl",
}: {
  rows?: number;
  label?: string;
  width?: string;
}) {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className={`mx-auto w-full ${width} px-5 py-8 sm:px-8`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 rounded-full border border-line bg-card px-3.5 py-1.5">
          <Spinner size={14} className="text-accent" />
          <span className="eyebrow">{label}</span>
        </div>
        <div className="skeleton h-8 w-24 rounded-full" />
      </div>

      <div className="mt-14 space-y-3">
        <div className="skeleton h-2.5 w-24 rounded-full" />
        <div className="skeleton h-9 w-64 max-w-full rounded-full" />
        <div className="skeleton h-3 w-full max-w-xl rounded-full" />
        <div className="skeleton h-3 w-4/5 max-w-lg rounded-full" />
      </div>

      <div className="mt-10 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="skeleton h-16 rounded-2xl border border-line"
            style={{ animationDelay: `${index * 90}ms` }}
          />
        ))}
      </div>
    </main>
  );
}
