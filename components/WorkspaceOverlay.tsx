"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

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
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-6">
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
        className="fade-in relative z-10 flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-canvas sm:max-h-[92vh] sm:max-w-6xl sm:flex-none sm:rounded-xl sm:border sm:border-line-strong sm:shadow-[0_28px_72px_rgba(0,0,0,0.45)]"
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line bg-raised px-4 md:px-6">
          <p className="text-[12.5px] font-semibold text-hi">Workspace</p>
          <button
            type="button"
            onClick={() => router.replace(closeHref)}
            className="btn gap-1.5 px-2.5 py-1 text-[12px]"
          >
            <X aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            <span>Close</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6 md:py-5">
          {children}
        </div>
      </div>
    </div>
  );
}
