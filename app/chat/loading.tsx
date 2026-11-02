/**
 * The workspace while the server reads GitHub.
 *
 * A chat page makes several GitHub calls before it can render, so this keeps the
 * frame — sidebar, header, composer — on screen instead of a blank flash.
 */
export default function ChatLoading() {
  return (
    <div className="min-h-dvh md:grid md:h-dvh md:grid-cols-[286px_minmax(0,1fr)]">
      <aside className="hidden border-r border-line bg-raised p-4 md:block">
        <div className="px-1 pb-5">
          <div className="h-6 w-28 animate-pulse rounded-full bg-chip" />
        </div>
        <div className="h-10 w-full animate-pulse rounded-full bg-chip" />
        <div className="mt-6 space-y-2">
          {Array.from({ length: 7 }).map((_, index) => (
            <div
              key={index}
              className="h-8 animate-pulse rounded-full bg-chip/70"
              style={{
                width: `${88 - index * 7}%`,
                animationDelay: `${index * 70}ms`,
              }}
            />
          ))}
        </div>
      </aside>

      <main className="flex min-h-dvh min-w-0 flex-col md:min-h-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 md:px-7">
          <div className="space-y-2">
            <div className="h-2.5 w-16 animate-pulse rounded-full bg-chip" />
            <div className="h-4 w-44 animate-pulse rounded-full bg-chip" />
          </div>
          <div className="h-7 w-20 animate-pulse rounded-full bg-chip" />
        </div>

        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 md:px-7">
          <div className="h-9 w-2/3 animate-pulse self-end rounded-[26px] bg-chip" />

          <div className="space-y-2.5">
            <div className="h-2.5 w-16 animate-pulse rounded-full bg-chip" />
            <div className="h-3 w-full animate-pulse rounded-full bg-chip" />
            <div className="h-3 w-11/12 animate-pulse rounded-full bg-chip" />
            <div className="h-3 w-4/5 animate-pulse rounded-full bg-chip" />
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-chip" />
          </div>

          <div className="mt-auto h-28 w-full animate-pulse rounded-[28px] border border-line bg-card" />
        </div>
      </main>
    </div>
  );
}
