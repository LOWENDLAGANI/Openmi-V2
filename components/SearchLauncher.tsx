"use client";

/**
 * The discoverable half of Ctrl/Cmd+K: a button that asks the palette to open.
 *
 * The palette owns the dialog and the keyboard shortcut; this only dispatches
 * the event, so the sidebar stays a server component. It is drawn as one of the
 * rail's five tool icons, matching the reference: the field this replaced took a
 * full row of a 292px column to say one word, and looked like an input nobody
 * could type in. The title carries the shortcut instead.
 */
export function SearchLauncher() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("openmi:search"))}
      aria-label="Search chats and messages"
      title="Search chats and messages (Ctrl+K)"
      className="rail-icon grid size-10 place-items-center rounded-xl"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-[19px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        <circle cx="10.8" cy="10.8" r="6.3" />
        <path d="m16 16 4 4" />
      </svg>
    </button>
  );
}
