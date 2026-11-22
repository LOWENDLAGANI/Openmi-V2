/**
 * The conversation while it streams in, matching the real transcript dimensions
 * and reserving the composer height to avoid layout shift.
 */
export function ChatSkeleton({
  label = "Loading the conversation",
}: {
  label?: string;
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex items-center gap-2 pb-3">
        <div className="skeleton h-6 w-40 rounded-md" />
        <div className="skeleton h-6 w-20 rounded-md" />
        <div className="skeleton ml-auto h-6 w-16 rounded-md" />
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 overflow-hidden py-2">
        <div className="skeleton h-10 w-2/3 self-end rounded-xl" />

        <div className="space-y-2.5 rounded-xl border border-line bg-card p-4">
          <div className="skeleton h-3 w-20 rounded-md" />
          <div className="skeleton h-3.5 w-full rounded-md" />
          <div className="skeleton h-3.5 w-11/12 rounded-md" />
          <div className="skeleton h-3.5 w-4/5 rounded-md" />
          <div className="skeleton h-3.5 w-2/3 rounded-md" />
        </div>

        <div className="skeleton mt-auto h-28 w-full rounded-xl border border-line" />
      </div>
    </div>
  );
}
