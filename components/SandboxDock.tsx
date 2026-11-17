"use client";

import { useState, type ReactNode } from "react";

import { FileEditor } from "@/components/FileEditor";
import { PreviewPanel } from "@/components/PreviewPanel";
import { VersionPanel } from "@/components/VersionPanel";

/**
 * One dock for everything this chat's sandbox exposes.
 *
 * They used to be three stacked cards, each with its own border, its own
 * sentence and its own row of buttons, which read as three unrelated widgets
 * competing with the transcript. Then they shared one tab strip in the chat
 * column, which still put the editor between the reader and the conversation.
 * Now the dock lives in the workspace dialog opened from the header button, and
 * the repository browser rides along as the first panel: one button, one place,
 * nothing above the transcript.
 *
 * Every panel stays mounted and is hidden rather than unmounted, so an unsaved
 * edit in Files survives a look at Versions or the repository.
 */

type Tab = "repository" | "files" | "versions" | "changes" | "preview";

export function SandboxDock({
  chatId,
  files,
  versions,
  preview,
  repository,
  changes,
}: {
  chatId: string;
  files: boolean;
  versions: boolean;
  preview: boolean;
  /** The repository browser, rendered by the page and shown as the first tab. */
  repository?: ReactNode;
  /**
   * What was published to GitHub, rendered by the page. It is its own tab
   * because undo lives there now that an applied change has no review card.
   */
  changes?: ReactNode;
}) {
  const available: Array<{ id: Tab; label: string }> = [];
  if (repository) available.push({ id: "repository", label: "Repository" });
  if (files) available.push({ id: "files", label: "Files" });
  if (versions) available.push({ id: "versions", label: "Versions" });
  if (changes) available.push({ id: "changes", label: "Changes" });
  if (preview) available.push({ id: "preview", label: "Preview" });

  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = available.find((entry) => entry.id === picked)?.id ?? available[0]?.id ?? null;

  if (tab === null) return null;

  return (
    <div className="flex min-h-0 flex-col">
      {available.length > 1 ? (
        <div
          role="tablist"
          aria-label="Workspace panels"
          className="flex shrink-0 items-center gap-1 pb-3"
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
      ) : null}

      {repository ? (
        <div className={tab === "repository" ? "" : "hidden"}>{repository}</div>
      ) : null}

      <FileEditor chatId={chatId} enabled={files} active={tab === "files"} />
      <VersionPanel chatId={chatId} enabled={versions} active={tab === "versions"} />
      {changes ? (
        <div className={tab === "changes" ? "" : "hidden"}>{changes}</div>
      ) : null}
      <PreviewPanel chatId={chatId} enabled={preview} active={tab === "preview"} />
    </div>
  );
}
