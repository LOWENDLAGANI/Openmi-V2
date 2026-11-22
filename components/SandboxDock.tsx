"use client";

import { useState, type ReactNode } from "react";

import { FileEditor } from "@/components/FileEditor";
import { PreviewPanel } from "@/components/PreviewPanel";
import { VersionPanel } from "@/components/VersionPanel";

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
  repository?: ReactNode;
  changes?: ReactNode;
}) {
  const available: Array<{ id: Tab; label: string }> = [];
  if (repository) available.push({ id: "repository", label: "Repository" });
  if (files) available.push({ id: "files", label: "Files" });
  if (versions) available.push({ id: "versions", label: "Versions" });
  if (changes) available.push({ id: "changes", label: "Changes" });
  if (preview) available.push({ id: "preview", label: "Preview" });

  const [picked, setPicked] = useState<Tab | null>(null);
  const tab =
    available.find((entry) => entry.id === picked)?.id ?? available[0]?.id ?? null;

  if (tab === null) return null;

  return (
    <div className="flex min-h-0 flex-col">
      {available.length > 1 ? (
        <div
          role="tablist"
          aria-label="Workspace panels"
          className="mb-4 flex shrink-0 items-center gap-1 border-b border-line pb-2"
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
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? "bg-elevated text-hi shadow-[var(--card-shadow)]"
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
