import { Spinner } from "@/components/Loading";

/**
 * The workspace while the server reads GitHub.
 *
 * A chat page makes several GitHub calls before it can render, so this keeps the
 * frame — sidebar, header, composer — on screen instead of a blank flash. It
 * mirrors the real shell, including the mobile height, so the composer does not
 * jump when the transcript arrives.
 */
export default function ChatLoading() {
  return (
    <div
      aria-busy="true"
      className="flex h-dvh min-h-dvh flex-col overflow-hidden md:grid md:grid-cols-[286px_minmax(0,1fr)]"
    >
      <aside className="hidden border-r border-line bg-raised p-4 md:block">
        <div className="flex items-center gap-2.5 px-1 pb-5">
          <Spinner size={16} className="text-accent" />
          <div className="skeleton h-4 w-24 rounded-full" />
        </div>
        <div className="skeleton h-10 w-full rounded-full" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <div
              key={index}
              className="skeleton h-8 rounded-full"
              style={{ width: `${88 - index * 7}%` }}
            />
          ))}
        </div>
      </aside>

      <main className="flex h-dvh min-w-0 flex-col md:h-full md:min-h-0">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3 md:px-7">
          <div className="flex items-center gap-3">
            <div className="skeleton size-9 rounded-full md:hidden" />
            <div className="space-y-2">
              <div className="skeleton h-2.5 w-16 rounded-full" />
              <div className="skeleton h-4 w-44 rounded-full" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Spinner size={14} className="text-accent" />
            <span className="eyebrow hidden sm:inline">loading</span>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-hidden px-4 py-6 md:px-7">
          <div className="skeleton h-9 w-2/3 self-end rounded-[26px]" />

          <div className="space-y-2.5">
            <div className="skeleton h-2.5 w-16 rounded-full" />
            <div className="skeleton h-3 w-full rounded-full" />
            <div className="skeleton h-3 w-11/12 rounded-full" />
            <div className="skeleton h-3 w-4/5 rounded-full" />
            <div className="skeleton h-3 w-2/3 rounded-full" />
          </div>

          <div className="skeleton mt-auto h-28 w-full rounded-[28px] border border-line" />
        </div>
      </main>
    </div>
  );
}
