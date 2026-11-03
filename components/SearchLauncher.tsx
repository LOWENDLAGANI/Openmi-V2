"use client";

/**
 * The discoverable half of Ctrl/Cmd+K: a button that asks the palette to open.
 *
 * The palette owns the dialog and the keyboard shortcut; this only dispatches
 * the event, so the sidebar stays a server component. It is drawn as the search
 * field of the sidebar: a quiet chip with no border, because a bordered input
 * that is not an input invited people to type in it.
 */
export function SearchLauncher() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("openmi:search"))}
      aria-label="Search chats and messages"
      className="flex h-10 w-full items-center gap-2.5 rounded-xl bg-chip px-3 text-left text-[13px] text-low transition-colors hover:bg-hover hover:text-hi"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m16.5 16.5 4 4" />
      </svg>
      <span className="min-w-0 flex-1 truncate">Search</span>
      <kbd className="hidden shrink-0 rounded border border-line-strong px-1.5 py-0.5 font-mono text-[9px] text-low sm:inline">
        ⌘K
      </kbd>
    </button>
  );
}
