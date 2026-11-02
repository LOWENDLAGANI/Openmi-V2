/**
 * The shape of a page while the server is still answering.
 *
 * These pages make network calls before they can render anything (GitHub,
 * Supabase, provider probes), so a skeleton that matches the real layout is the
 * difference between "slow" and "broken". Motion is optional: the global
 * reduced-motion rule stops the pulse.
 */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
      <div className="flex items-center justify-between">
        <div className="h-6 w-28 animate-pulse rounded-full bg-chip" />
        <div className="h-8 w-24 animate-pulse rounded-full bg-chip" />
      </div>

      <div className="mt-14 space-y-3">
        <div className="h-2.5 w-24 animate-pulse rounded-full bg-chip" />
        <div className="h-9 w-64 animate-pulse rounded-full bg-chip" />
        <div className="h-3 w-full max-w-xl animate-pulse rounded-full bg-chip" />
        <div className="h-3 w-4/5 max-w-lg animate-pulse rounded-full bg-chip" />
      </div>

      <div className="mt-10 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-2xl border border-line bg-card"
            style={{ animationDelay: `${index * 70}ms` }}
          />
        ))}
      </div>
    </main>
  );
}
