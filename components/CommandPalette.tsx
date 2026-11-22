"use client";

import { CornerDownLeft, FileText, MessageSquare, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { MIN_QUERY_CHARS } from "@/lib/search";

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
        hint: "Chat thread",
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

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close search"
        onClick={() => setOpen(false)}
        className="fade-in absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search chats and messages"
        className="animate-pop relative w-full max-w-xl overflow-hidden rounded-xl border border-line-strong bg-card shadow-[0_28px_72px_rgba(0,0,0,0.42)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-low" strokeWidth={1.75} />

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
                setActive((current) =>
                  results.length === 0 ? 0 : (current + 1) % results.length
                );
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
            className="min-w-0 flex-1 bg-transparent text-[14px] text-hi placeholder:text-low focus:outline-none"
          />

          {loading && <div className="skeleton size-4 rounded-md" />}

          <kbd className="rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[10px] text-low">
            esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {query.trim().length < MIN_QUERY_CHARS ? (
            <p className="px-3 py-8 text-center text-[12.5px] leading-relaxed text-low">
              Type at least {MIN_QUERY_CHARS} characters to search your threads.
            </p>
          ) : error ? (
            <p role="alert" className="px-3 py-8 text-center text-[12.5px] text-danger">
              {error}
            </p>
          ) : results.length === 0 ? (
            loading ? (
              <div className="space-y-1.5 px-2 py-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="skeleton h-10 rounded-lg"
                    style={{ animationDelay: `${index * 90}ms` }}
                  />
                ))}
              </div>
            ) : (
              <p className="px-3 py-8 text-center text-[12.5px] text-low">
                No matching chats or messages.
              </p>
            )
          ) : (
            <ul role="listbox" aria-label="Search results" className="space-y-0.5">
              {results.map((result, index) => {
                const Icon = result.kind === "chat" ? MessageSquare : FileText;
                const isSelected = index === active;
                return (
                  <li key={`${result.kind}-${result.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(result)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                        isSelected ? "bg-elevated text-hi" : "hover:bg-hover"
                      }`}
                    >
                      <Icon
                        aria-hidden="true"
                        className={`size-4 shrink-0 ${
                          isSelected ? "text-accent-text" : "text-low"
                        }`}
                        strokeWidth={1.75}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-hi">
                          {result.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-low">
                          {result.hint}
                        </span>
                      </span>
                      {isSelected && (
                        <CornerDownLeft
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-low"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-raised px-4 py-2 font-mono text-[11px] text-low">
          <span>↑↓ navigate · ↵ open</span>
          <span className="tabular-nums">
            {results.length} result{results.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
