"use client";

import { useEffect, useState } from "react";

/**
 * The chat shell.
 *
 * On a wide screen the sidebar is a fixed column beside the conversation. On a
 * phone it is a drawer behind the menu button, because stacking a full-height
 * chat list above the chat is how a new chat ends up "somewhere below".
 */
export function AppShell({
  sidebar,
  eyebrow,
  title,
  actions,
  banner,
  children,
}: {
  sidebar: React.ReactNode;
  eyebrow: string;
  title: React.ReactNode;
  actions?: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden md:grid md:grid-cols-[292px_minmax(0,1fr)]">
      <div className="hidden min-h-0 md:block">{sidebar}</div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fade-in absolute inset-0 bg-black/45 backdrop-blur-[2px]"
          />
          <div className="drawer-in absolute inset-y-0 left-0 w-[86%] max-w-[320px] overflow-y-auto bg-bg-raised shadow-[0_18px_40px_-24px_rgba(17,24,39,0.28)]">
            {sidebar}
          </div>
        </div>
      )}

      <main className="flex h-dvh min-w-0 flex-col md:h-full md:min-h-0">
        <header className="sticky top-0 z-30 flex shrink-0 items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 py-2.5 backdrop-blur-xl md:px-7">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open chats"
              className="rail-icon grid size-9 shrink-0 place-items-center rounded-xl md:hidden"
            >
              <span aria-hidden="true" className="space-y-[3px]">
                <span className="block h-[1.5px] w-4 bg-current" />
                <span className="block h-[1.5px] w-4 bg-current" />
                <span className="block h-[1.5px] w-4 bg-current" />
              </span>
            </button>

            <div className="min-w-0">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-low">
                {eyebrow}
              </p>
              <h1 className="truncate text-[15px] font-medium tracking-[-0.02em] text-hi">
                {title}
              </h1>
            </div>
          </div>

          {actions && (
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              {actions}
            </div>
          )}
        </header>

        {banner}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 md:px-7 md:pb-7">
          {children}
        </div>
      </main>
    </div>
  );
}
