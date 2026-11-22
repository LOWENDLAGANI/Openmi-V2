/**
 * Route-level loading skeleton while server data resolves.
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
      aria-label={label}
      className={`mx-auto w-full ${width} px-5 py-8 sm:px-8`}
    >
      <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
        <div className="skeleton h-6 w-32 rounded-md" />
        <div className="skeleton h-8 w-24 rounded-lg" />
      </div>

      <div className="mt-10 space-y-3">
        <div className="skeleton h-3 w-24 rounded-md" />
        <div className="skeleton h-9 w-64 max-w-full rounded-lg" />
        <div className="skeleton h-3.5 w-full max-w-xl rounded-md" />
        <div className="skeleton h-3.5 w-4/5 max-w-lg rounded-md" />
      </div>

      <div className="mt-8 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="skeleton h-16 rounded-xl border border-line"
            style={{ animationDelay: `${index * 90}ms` }}
          />
        ))}
      </div>
    </main>
  );
}
