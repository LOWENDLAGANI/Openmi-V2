"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PublishButton } from "@/components/PublishButton";
import { PULL_CONFIRMATION } from "@/lib/execution/sync/plan";

/**
 * The versions of a chat's workspace.
 *
 * Collapsed to one line until opened, because a conversation is still the main
 * thing on the page. A version is a commit inside the sandbox clone and nothing
 * more: the panel never implies it reached GitHub, and the restore confirmation
 * says what is lost (uncommitted work in the sandbox).
 */

type Checkpoint = {
  sha: string;
  label: string;
  files: number;
  source: "turn" | "manual";
  createdAt: string;
};

export function VersionPanel({
  chatId,
  enabled,
  active = true,
}: {
  chatId: string;
  enabled: boolean;
  /** False while another tab of the dock is on screen. Hidden, never unmounted. */
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Checkpoint[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/checkpoints/${chatId}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | { checkpoints?: Checkpoint[]; error?: string }
        | null;

      if (!response.ok || !body) {
        setError(body?.error ?? "The versions could not be read.");
        return;
      }

      setVersions(body.checkpoints ?? []);
    } catch {
      setError("The versions could not be read.");
    }
  }, [chatId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  if (!enabled) return null;

  const count = versions?.length ?? 0;

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/checkpoints/${chatId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save" }),
      });
      const body = (await response.json().catch(() => null)) as
        | { created?: boolean; error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error ?? "The version could not be saved.");
      } else {
        setNotice(
          body?.created
            ? "Saved a version of the workspace."
            : "Nothing changed since the last version."
        );
      }

      await refresh();
    } catch {
      setError("The version request did not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(sha: string) {
    if (
      !window.confirm(
        "Restore this version? Uncommitted changes in the sandbox are discarded. GitHub is not affected."
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/checkpoints/${chatId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restore", sha }),
      });
      const body = (await response.json().catch(() => null)) as
        | { head?: string; error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error ?? "That version could not be restored.");
      } else {
        setNotice(`The workspace is at ${body?.head?.slice(0, 7) ?? "that version"}.`);
      }
    } catch {
      setError("The restore request did not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function pull() {
    if (!window.confirm(PULL_CONFIRMATION)) return;

    setPulling(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/sync/${chatId}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { verdict?: string; head?: string; error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error ?? "The branch could not be pulled.");
      } else if (body?.verdict === "up-to-date") {
        setNotice("This workspace is already at the branch head.");
      } else {
        setNotice(
          `The pin moved to ${body?.head?.slice(0, 7) ?? "the branch head"}. The next turn reseeds the workspace.`
        );
        router.refresh();
      }
    } catch {
      setError("The pull request did not reach the server.");
    } finally {
      setPulling(false);
    }
  }

  return (
    <div className={active ? "" : "hidden"}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 text-[11px] text-mid hover:text-hi"
        >
          <span aria-hidden="true" className="text-low">
            {open ? "▾" : "▸"}
          </span>
          <span className="truncate">
            {count === 0 ? "none yet" : `${count} version${count === 1 ? "" : "s"}`}
            <span className="text-low"> · in this sandbox</span>
          </span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={pull}
            disabled={pulling}
            title="Move this chat's pin to the branch head. The workspace is reseeded on the next turn."
            className="btn px-2 py-0.5 text-[10.5px]"
          >
            {pulling ? "Pulling…" : "Pull latest"}
          </button>

          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="btn px-2 py-0.5 text-[10.5px]"
          >
            Save version
          </button>

          <PublishButton chatId={chatId} />
        </div>
      </div>

      {open ? (
        <div className="border-t border-line">
          {versions === null ? (
            <p className="px-3 py-2.5 text-[11px] text-mid">Reading versions…</p>
          ) : versions.length === 0 ? (
            <p className="px-3 py-2.5 text-[11px] leading-relaxed text-mid">
              No versions yet. One is made after each turn that changes a file,
              and you can save one by hand.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {versions.map((version) => (
                <li
                  key={version.sha}
                  className="flex flex-wrap items-center gap-2 px-3 py-2"
                >
                  <span className="font-mono text-[10.5px] text-low">
                    {version.sha.slice(0, 7)}
                  </span>
                  <span className="text-[11.5px] text-hi">{version.label}</span>
                  <span className="text-[10.5px] text-low">
                    {version.files} file{version.files === 1 ? "" : "s"}
                    {version.source === "manual" ? " · saved by hand" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => restore(version.sha)}
                    disabled={busy}
                    className="btn ml-auto px-2 py-0.5 text-[10.5px]"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {notice ? (
        <p className="border-t border-line px-3 py-2 text-[11px] text-accent-text">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
