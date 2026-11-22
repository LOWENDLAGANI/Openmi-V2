"use client";

import { Search } from "lucide-react";

/**
 * Opens the global Cmd/Ctrl+K search command palette from the sidebar.
 */
export function SearchLauncher() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("openmi:search"))}
      aria-label="Search chats and messages"
      title="Search chats and messages (Ctrl+K)"
      className="flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-line bg-card px-2.5 text-[12.5px] text-low transition-colors hover:border-line-strong hover:text-hi"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Search aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">Search…</span>
      </span>
      <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] leading-none text-low">
        ⌘K
      </kbd>
    </button>
  );
}
