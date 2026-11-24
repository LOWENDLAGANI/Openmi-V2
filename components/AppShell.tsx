"use client";

import { Menu } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The workspace shell.
 *
 * Desktop renders a fixed 268px rail beside the transcript; narrow screens
 * mount the rail inside a slide-over drawer.
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
    <div className="consent-aware-viewport flex min-h-0 flex-col overflow-hidden md:grid md:grid-cols-[268px_minmax(0,1fr)]">
      <div className="hidden min-h-0 md:block">{sidebar}</div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fade-in absolute inset-0 bg-black/45 backdrop-blur-[2px]"
          />
          <div className="drawer-in absolute inset-y-0 left-0 w-[85%] max-w-[300px] overflow-y-auto border-r border-line bg-raised shadow-[0_24px_56px_rgba(0,0,0,0.35)]">
            {sidebar}
          </div>
        </div>
      )}

      <main className="consent-aware-viewport flex min-w-0 flex-col md:h-full md:min-h-0">
        <header className="sticky top-0 z-30 flex h-13 shrink-0 items-center justify-between gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md md:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open chats"
              className="rail-icon grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-card md:hidden"
            >
              <Menu aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </button>

            <div className="flex min-w-0 items-baseline gap-2">
              <span className="hidden shrink-0 text-[12px] font-medium text-low sm:inline">
                {eyebrow}
              </span>
              <span
                aria-hidden="true"
                className="hidden shrink-0 text-[12px] text-line-strong sm:inline"
              >
                /
              </span>
              <h1 className="truncate text-[14px] font-semibold tracking-[-0.02em] text-hi">
                {title}
              </h1>
            </div>
          </div>

          {actions && (
            <div className="flex shrink-0 items-center gap-2">
              {actions}
            </div>
          )}
        </header>

        {banner}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-6 md:pb-6">
          {children}
        </div>
      </main>
    </div>
  );
}
