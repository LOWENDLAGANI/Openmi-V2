"use client";

import { useState } from "react";

import { FileEditor } from "@/components/FileEditor";
import { PreviewPanel } from "@/components/PreviewPanel";
import { VersionPanel } from "@/components/VersionPanel";

/**
 * One dock for the three things this chat's sandbox exposes.
 *
 * They used to be three stacked cards, each with its own border, its own
 * sentence and its own row of buttons, which read as three unrelated widgets
 * competing with the transcript. Here they share one card and one tab strip:
 * the reader sees three names, one panel is on screen, and the other two keep
 * their state — an unsaved edit in Files survives a look at Versions — because
 * they stay mounted and are hidden rather than unmounted.
 */

type Tab = "files" | "versions" | "preview";

export function SandboxDock({
  chatId,
  files,
  versions,
  preview,
}: {
  chatId: string;
  files: boolean;
  versions: boolean;
  preview: boolean;
}) {
  const available: Array<{ id: Tab; label: string }> = [];
  if (files) available.push({ id: "files", label: "Files" });
  if (versions) available.push({ id: "versions", label: "Versions" });
  if (preview) available.push({ id: "preview", label: "Preview" });

  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = available.find((entry) => entry.id === picked)?.id ?? available[0]?.id ?? null;

  if (tab === null) return null;

  return (
    <div className="mb-2 shrink-0 overflow-hidden rounded-2xl border border-line bg-card">
      <div
        role="tablist"
        aria-label="Workspace panels"
        className="flex items-center gap-1 border-b border-line px-1.5 py-1"
      >
        {available.map((entry) => {
          const active = entry.id === tab;

          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPicked(entry.id)}
              className={`rounded-full px-2.5 py-1 text-[11.5px] transition-colors ${
                active
                  ? "bg-raised font-medium text-hi"
                  : "text-mid hover:bg-hover hover:text-hi"
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <FileEditor chatId={chatId} enabled={files} active={tab === "files"} />
      <VersionPanel chatId={chatId} enabled={versions} active={tab === "versions"} />
      <PreviewPanel chatId={chatId} enabled={preview} active={tab === "preview"} />
    </div>
  );
}
