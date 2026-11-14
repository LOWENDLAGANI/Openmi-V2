import { Spinner } from "@/components/Loading";

/**
 * The conversation while it streams in.
 *
 * This is the in-page fallback, not the route skeleton: the sidebar, header and
 * account bar are already painted by the time it appears, so it only has to
 * describe the column that is still loading. Shapes match the real transcript —
 * a user bubble, an answer, and the composer's height — so the arrival of the
 * data does not move anything (CLS) and the wait reads as "loading this
 * conversation", not "the app froze".
 *
 * One spinner, at the top, because the wait is short: NN/g's rule is a skeleton
 * for a full region under ten seconds, and a spinner only for a small module.
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
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex items-center gap-2 pb-3">
        <div className="skeleton h-6 w-40 rounded-full" />
        <div className="skeleton h-6 w-20 rounded-full" />
        <span className="ml-auto flex items-center gap-2">
          <Spinner size={13} className="text-accent" />
          <span className="sr-only">{label}</span>
        </span>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 overflow-hidden py-2">
        <div className="skeleton h-9 w-2/3 self-end rounded-[26px]" />

        <div className="space-y-2.5">
          <div className="skeleton h-2.5 w-16 rounded-full" />
          <div className="skeleton h-3 w-full rounded-full" />
          <div className="skeleton h-3 w-11/12 rounded-full" />
          <div className="skeleton h-3 w-4/5 rounded-full" />
          <div className="skeleton h-3 w-2/3 rounded-full" />
        </div>

        {/* The composer's height is reserved, so the page does not jump when the
            real capsule replaces this block. */}
        <div className="skeleton mt-auto h-28 w-full rounded-[28px] border border-line" />
      </div>
    </div>
  );
}
