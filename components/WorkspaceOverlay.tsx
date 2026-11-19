"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * The repository browser as a dialog, opened from the header button.
 *
 * It used to be a page: `?view=files` replaced the conversation with the file
 * tree and the code view, so opening a citation meant leaving the chat you were
 * reading. Here the chat stays mounted underneath and the tree arrives in a
 * layer of its own, closed with the button, Escape or the backdrop.
 *
 * Closing replaces the history entry rather than pushing one, so Back returns
 * to wherever the reader came from instead of reopening the panel.
 */
export function WorkspaceOverlay({
  closeHref,
  children,
}: {
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    const close = () => router.replace(closeHref);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref, router]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/45 p-0 sm:items-center sm:justify-center sm:p-6">
      <button
        type="button"
        aria-label="Close workspace"
        onClick={() => router.replace(closeHref)}
        className="absolute inset-0 cursor-default"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Workspace"
        className="fade-in relative z-10 flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-canvas sm:max-h-[92vh] sm:max-w-6xl sm:flex-none sm:rounded-2xl sm:border sm:border-line sm:shadow-[0_24px_56px_-28px_rgba(17,24,39,0.4)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2 md:px-6">
          <p className="eyebrow">workspace</p>
          <button
            type="button"
            onClick={() => router.replace(closeHref)}
            className="btn px-3 py-1 text-[11.5px]"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6 md:py-5">
          {children}
        </div>
      </div>
    </div>
  );
}
