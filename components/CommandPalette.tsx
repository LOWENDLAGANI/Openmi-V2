"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Spinner } from "@/components/Loading";
import { MIN_QUERY_CHARS } from "@/lib/search";

/**
 * Ctrl/Cmd+K: one box over this account's chats and messages.
 *
 * The search runs on the server under RLS — this app has no local database, so
 * a client-side index would either be empty or a privacy problem. Results are
 * debounced and aborted on each keystroke, and the dialog is keyboard-first:
 * arrows move, Enter opens, Escape closes.
 */

type ChatHit = { id: string; title: string; updatedAt: string };
type MessageHit = {
  id: string;
  chatId: string;
  chatTitle: string;
  snippet: string;
  createdAt: string;
};

type Result =
  | { kind: "chat"; id: string; title: string; hint: string }
  | { kind: "message"; id: string; chatId: string; title: string; hint: string };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatHit[]>([]);
  const [messages, setMessages] = useState<MessageHit[]>([]);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo<Result[]>(
    () => [
      ...chats.map((chat) => ({
        kind: "chat" as const,
        id: chat.id,
        title: chat.title,
        hint: "chat",
      })),
      ...messages.map((message) => ({
        kind: "message" as const,
        id: message.id,
        chatId: message.chatId,
        title: message.chatTitle,
        hint: message.snippet,
      })),
    ],
    [chats, messages]
  );

  // Opening from anywhere: the shortcut, or the sidebar button's event.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === "Escape") setOpen(false);
    }

    function onRequest() {
      setOpen(true);
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("openmi:search", onRequest);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("openmi:search", onRequest);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setActive(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // Debounced, aborted search. A keystroke cancels the request it replaced, so
  // a slow answer cannot overwrite a newer one.
  useEffect(() => {
    if (!open) return;

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_CHARS) {
      setChats([]);
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);

      void fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => null)) as
            | { chats?: ChatHit[]; messages?: MessageHit[]; error?: string }
            | null;

          if (!response.ok) {
            throw new Error(payload?.error ?? `Search failed (${response.status}).`);
          }

          setChats(Array.isArray(payload?.chats) ? payload.chats : []);
          setMessages(Array.isArray(payload?.messages) ? payload.messages : []);
          setActive(0);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setError(caught instanceof Error ? caught.message : "Search failed.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  function choose(result: Result) {
    setOpen(false);
    setQuery("");
    router.push(
      result.kind === "chat" ? `/chat?chat=${result.id}` : `/chat?chat=${result.chatId}`
    );
  }

  if (!open) return null;

  const body = createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close search"
        onClick={() => setOpen(false)}
        className="fade-in absolute inset-0 bg-black/55 backdrop-blur-[3px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search chats and messages"
        className="animate-pop relative w-full max-w-xl overflow-hidden rounded-2xl border border-line-strong bg-card shadow-[0_30px_80px_rgba(0,0,0,0.45)]"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-4 shrink-0 text-low"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m16.5 16.5 4 4" />
          </svg>

          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setOpen(false);
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) =>
                  results.length === 0 ? 0 : (current - 1 + results.length) % results.length
                );
              }
              if (event.key === "Enter" && results[active]) {
                event.preventDefault();
                choose(results[active]);
              }
            }}
            placeholder="Search chats and messages…"
            aria-label="Search chats and messages"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-body placeholder:text-low focus:outline-none"
          />

          {loading && <Spinner size={14} />}

          <kbd className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[9.5px] text-low">
            esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {query.trim().length < MIN_QUERY_CHARS ? (
            <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-low">
              Type at least {MIN_QUERY_CHARS} characters. Search covers chat titles
              and message text in this account only.
            </p>
          ) : error ? (
            <p role="alert" className="px-3 py-6 text-center text-[12px] text-danger">
              {error}
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-low">
              {loading ? "Searching…" : "No chat or message matches that."}
            </p>
          ) : (
            <ul role="listbox" aria-label="Search results">
              {results.map((result, index) => (
                <li key={`${result.kind}-${result.id}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(result)}
                    className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left ${
                      index === active ? "bg-elevated" : "hover:bg-hover"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                        result.kind === "chat" ? "bg-accent" : "bg-line-strong"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-hi">
                        {result.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-low">
                        {result.hint}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-low">
          <span>↑ ↓ move · enter open</span>
          <span>{results.length} result{results.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>,
    document.body
  );

  return body;
}
