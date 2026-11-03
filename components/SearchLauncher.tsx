"use client";

/**
 * The discoverable half of Ctrl/Cmd+K: a button that asks the palette to open.
 *
 * The palette owns the dialog and the keyboard shortcut; this only dispatches
 * the event, so the sidebar stays a server component.
 */
export function SearchLauncher() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("openmi:search"))}
      aria-label="Search chats and messages"
      className="lift flex w-full items-center gap-2 rounded-2xl border border-line bg-card px-3 py-2 text-left text-[12px] text-mid hover:bg-hover hover:text-hi"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-3.5 shrink-0 text-low"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m16.5 16.5 4 4" />
      </svg>
      <span className="min-w-0 flex-1 truncate">Search chats</span>
      <kbd className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[9px] text-low">
        ⌘K
      </kbd>
    </button>
  );
}
