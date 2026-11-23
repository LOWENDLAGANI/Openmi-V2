"use client";

import { History, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { APP_VERSION_TAG, CHANGELOG } from "@/lib/version";

export function VersionBadge({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Version ${APP_VERSION_TAG} — view changelog`}
        title={`Version ${APP_VERSION_TAG} — view changelog`}
        className={`inline-flex items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-mid transition-colors hover:border-line-strong hover:bg-hover hover:text-hi ${className}`}
      >
        <span>{APP_VERSION_TAG}</span>
      </button>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Close changelog"
              onClick={() => setOpen(false)}
              className="fade-in absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            />

            <div
              role="dialog"
              aria-modal="true"
              aria-label="Openmi changelog"
              className="animate-pop relative flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line-strong bg-card shadow-[0_28px_72px_rgba(0,0,0,0.42)]"
            >
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <History
                    aria-hidden="true"
                    className="size-4 shrink-0 text-accent-text"
                    strokeWidth={1.75}
                  />
                  <h2 className="text-[14.5px] font-semibold tracking-[-0.02em] text-hi">
                    Changelog
                  </h2>
                  <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-accent-text">
                    {APP_VERSION_TAG}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close changelog"
                  className="rail-icon grid size-7 place-items-center rounded-md text-low hover:text-hi"
                >
                  <X aria-hidden="true" className="size-4" strokeWidth={1.75} />
                </button>
              </div>

              <div className=" space-y-6 overflow-y-auto px-5 py-4">
                {CHANGELOG.map((entry, index) => (
                  <article
                    key={entry.version}
                    className={index > 0 ? "border-t border-line pt-5" : ""}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[11.5px] font-semibold tabular-nums text-hi">
                          v{entry.version}
                        </span>
                        <h3 className="text-[13.5px] font-semibold text-hi">
                          {entry.title}
                        </h3>
                      </div>
                      <time
                        dateTime={entry.date}
                        className="font-mono text-[11px] tabular-nums text-low"
                      >
                        {entry.date}
                      </time>
                    </div>

                    <ul className="mt-3 space-y-2 text-[12.5px] leading-relaxed text-mid">
                      {entry.changes.map((change) => (
                        <li key={change} className="flex items-start gap-2">
                          <span
                            aria-hidden="true"
                            className="mt-2 size-1 shrink-0 rounded-full bg-accent-text"
                          />
                          <span>{change}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-line bg-raised px-5 py-2.5 font-mono text-[11px] text-low">
                <span>Current build: {APP_VERSION_TAG}</span>
                <span>esc to close</span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
