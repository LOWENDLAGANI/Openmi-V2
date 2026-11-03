"use client";

/**
 * The six suggestion chips above the composer.
 *
 * A chip writes its prompt into the composer; it never sends. Sending on a
 * stray tap would spend Dew without the reader writing anything, so the last
 * action always belongs to them.
 */

const ICONS: Record<string, React.ReactNode> = {
  explain: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
    </>
  ),
  bug: (
    <>
      <path d="M9 4.5 10.5 7M15 4.5 13.5 7" />
      <rect x="7" y="9" width="10" height="11" rx="5" />
      <path d="M7 13H4M17 13h3M8 18l-2.5 2M16 18l2.5 2" />
    </>
  ),
  review: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  test: (
    <>
      <path d="M9 3h6M10 3v6l-4.5 8A2 2 0 0 0 7.3 20h9.4a2 2 0 0 0 1.8-3L14 9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  plan: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
      <path d="M11 7.5h3.5A2.5 2.5 0 0 1 17 10v3" />
    </>
  ),
  summarise: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M10 12h7M10 15.5h7M10 8.5h2.5" />
    </>
  ),
};

export const QUICK_ACTIONS = [
  { id: "explain", label: "Explain this repo", prompt: "Explain this repository: what it does, how it is laid out, and where the main entry points are." },
  { id: "bug", label: "Find a bug", prompt: "Look for the most likely bug in this repository and cite the path and line where it lives." },
  { id: "review", label: "Review changes", prompt: "Review the most recent changes for correctness, and say plainly what you could not verify." },
  { id: "test", label: "Write a test", prompt: "Write a test for the piece of this repository most likely to regress, and explain what it pins." },
  { id: "plan", label: "Plan a feature", prompt: "Plan a feature for this repository: the files it touches, the order of work, and the risks." },
  { id: "summarise", label: "Summarise a file", prompt: "Summarise the file I have open: its responsibilities, its callers, and what would break if it changed." },
] as const;

export function QuickActions({
  onSelect,
  disabled = false,
}: {
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      aria-label="Suggested prompts"
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onSelect(action.prompt)}
          disabled={disabled}
          className="quick-chip lift disabled:opacity-50"
        >
          <svg
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            className="size-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {ICONS[action.id]}
          </svg>
          {action.label}
        </button>
      ))}
    </div>
  );
}
