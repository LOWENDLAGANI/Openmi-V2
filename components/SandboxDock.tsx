"use client";

import { useState } from "react";

import { FileEditor } from "@/components/FileEditor";
import { PreviewPanel } from "@/components/PreviewPanel";
import { VersionPanel } from "@/components/VersionPanel";

/**
 * One dock for the three things this chat's sandbox exposes, behind a trigger.
 *
 * The dock holds Files, Versions and Preview in one card with one tab strip, so
 * they read as one control rather than three cards competing with the
 * transcript. It is closed until the reader asks for it: the chat column is the
 * conversation, and a box that is always open sits between the reader and the
 * answer even when nobody is editing anything. Only the small trigger is there
 * by default.
 *
 * Closing the dock hides the panels rather than unmounting them, so the state
 * they hold — an unsaved edit in Files, a preview URL already loaded — survives
 * the same way it survives a look at another tab.
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
  const [open, setOpen] = useState(false);
  const tab = available.find((entry) => entry.id === picked)?.id ?? available[0]?.id ?? null;

  if (tab === null) return null;

  return (
    <div className="mb-2 shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="workspace-dock"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-mid transition-colors hover:bg-hover hover:text-hi"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        Workspace
      </button>

      <div
        id="workspace-dock"
        hidden={!open}
        className="mt-1.5 overflow-hidden rounded-2xl border border-line bg-card"
      >
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

        <FileEditor chatId={chatId} enabled={files} active={open && tab === "files"} />
        <VersionPanel
          chatId={chatId}
          enabled={versions}
          active={open && tab === "versions"}
        />
        <PreviewPanel
          chatId={chatId}
          enabled={preview}
          active={open && tab === "preview"}
        />
      </div>
    </div>
  );
}
