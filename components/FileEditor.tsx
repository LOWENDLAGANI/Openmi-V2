"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A plain editor over the workspace.
 *
 * Collapsed until opened, and deliberately plain: a textarea with a monospace
 * face, a file list and a save. The alternative — a syntax-highlighting editor
 * library — is a dependency this slice has not earned yet.
 *
 * The note under the toolbar is the important part: a save writes to the
 * sandbox's branch, not to GitHub. It becomes a version on the next turn, and it
 * reaches the repository only through a change request.
 */

export function FileEditor({
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
  const [files, setFiles] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/files/${chatId}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as
        | { files?: string[]; error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error ?? "The workspace could not be listed.");
        return;
      }

      setFiles(body?.files ?? []);
    } catch {
      setError("The workspace could not be listed.");
    } finally {
      setBusy(false);
    }
  }, [chatId]);

  useEffect(() => {
    if (!enabled || !open || files !== null) return;
    void loadList();
  }, [enabled, open, files, loadList]);

  if (!enabled) return null;

  async function pick(path: string) {
    if (text !== original && !window.confirm("Discard the unsaved edit?")) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/files/${chatId}?path=${encodeURIComponent(path)}`,
        { cache: "no-store" }
      );
      const body = (await response.json().catch(() => null)) as
        | { path?: string; text?: string; error?: string }
        | null;

      if (!response.ok || typeof body?.text !== "string") {
        setError(body?.error ?? "That file could not be read.");
        return;
      }

      setSelected(body.path ?? path);
      setText(body.text);
      setOriginal(body.text);
    } catch {
      setError("That file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  // The save is optimistic: the editor stops being dirty on the click, so the
  // reader can keep working instead of watching a button. A failure puts the
  // unsaved state back, which is the snap back the reader needs to see.
  async function save() {
    if (!selected || saving) return;

    const before = original;
    const written = text;

    setSaving(true);
    setError(null);
    setNotice(null);
    setOriginal(written);

    try {
      const response = await fetch(`/api/files/${chatId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: selected, text: written }),
      });
      const body = (await response.json().catch(() => null)) as
        | { bytes?: number; error?: string }
        | null;

      if (!response.ok) {
        setOriginal(before);
        setError(body?.error ?? "The file could not be saved.");
        return;
      }

      setNotice(
        `Saved to the sandbox${typeof body?.bytes === "number" ? ` (${body.bytes} bytes)` : ""}.`
      );
    } catch {
      setOriginal(before);
      setError("The save did not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = selected !== null && text !== original;

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
          <span className="truncate font-mono">
            {selected ?? "workspace copy"}
            {files ? ` · ${files.length} file${files.length === 1 ? "" : "s"}` : ""}
          </span>
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {open ? (
            <button
              type="button"
              onClick={() => {
                setFiles(null);
              }}
              disabled={busy}
              className="btn px-2 py-0.5 text-[10.5px]"
            >
              Refresh
            </button>
          ) : null}

          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            aria-busy={saving}
            className="btn px-2 py-0.5 text-[10.5px]"
          >
            {saving ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="flex max-h-[46vh] min-h-0 border-t border-line">
          <ul className="w-44 shrink-0 overflow-y-auto border-r border-line py-1">
            {files === null ? (
              <li className="px-3 py-2 text-[11px] text-mid">Reading files…</li>
            ) : files.length === 0 ? (
              <li className="px-3 py-2 text-[11px] text-mid">No files yet.</li>
            ) : (
              files.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => pick(path)}
                    className={`block w-full truncate px-3 py-1.5 text-left font-mono text-[10.5px] ${
                      path === selected ? "bg-raised text-hi" : "text-mid hover:bg-raised"
                    }`}
                    title={path}
                  >
                    {path}
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="flex min-w-0 flex-1 flex-col">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              placeholder={selected ? "" : "Pick a file to edit."}
              aria-label="File content"
              className="min-h-[30vh] w-full flex-1 resize-none bg-transparent p-3 font-mono text-[11.5px] leading-relaxed text-body outline-none"
            />
          </div>
        </div>
      ) : null}

      {open ? (
        <p className="border-t border-line px-3 py-2 text-[10.5px] leading-relaxed text-low">
          Saves to this chat&apos;s sandbox; GitHub changes only through a change
          request.
          {dirty ? " Unsaved changes." : ""}
        </p>
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
