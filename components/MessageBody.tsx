"use client";

import Link from "next/link";
import { useMemo } from "react";

type RepoRef = { fullName: string; branch: string; sha: string } | null;

type Segment =
  | { kind: "text"; text: string }
  | { kind: "cite"; text: string; path: string; line: number };

const CITATION = /(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,8}):(\d{1,6})/g;

/**
 * Renders an answer, turning a citation into a link only when it resolves.
 *
 * The rule from the phase gate: every rendered citation resolves to a real path
 * at the pinned commit, or it renders as plain text. The server passes the
 * paths that exist in that commit, so a model that invents `lib/nope.ts:12`
 * produces text the reader can see is not a link.
 */
export function MessageBody({
  content,
  repo,
  validPaths,
  chatId,
}: {
  content: string;
  repo: RepoRef;
  validPaths: string[];
  chatId: string;
}) {
  const segments = useMemo(() => {
    const known = new Set(validPaths);
    const parts: Segment[] = [];
    let cursor = 0;

    for (const match of content.matchAll(CITATION)) {
      const path = match[1];
      const line = Number(match[2]);
      const start = match.index ?? 0;

      if (start > cursor) {
        parts.push({ kind: "text", text: content.slice(cursor, start) });
      }

      const resolves = repo !== null && known.has(path) && Number.isFinite(line);

      if (resolves) {
        parts.push({ kind: "cite", text: match[0], path, line });
      } else {
        parts.push({ kind: "text", text: match[0] });
      }

      cursor = start + match[0].length;
    }

    if (cursor < content.length) {
      parts.push({ kind: "text", text: content.slice(cursor) });
    }

    return parts;
  }, [content, repo, validPaths]);

  if (segments.length === 0) {
    return <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-body">{content}</p>;
  }

  return (
    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-body">
      {segments.map((segment, index) => {
        if (segment.kind === "text") return <span key={index}>{segment.text}</span>;

        const params = new URLSearchParams({
          chat: chatId,
          repo: repo?.fullName ?? "",
          branch: repo?.branch ?? "",
          sha: repo?.sha ?? "",
          path: segment.path,
          line: String(segment.line),
          view: "files",
        });

        return (
          <Link
            key={index}
            href={`/chat?${params.toString()}`}
            className="rounded bg-accent-soft px-1 font-mono text-[12px] text-accent-text underline-offset-2 hover:underline"
            title={`Open ${segment.path} at line ${segment.line}`}
          >
            {segment.text}
          </Link>
        );
      })}
    </p>
  );
}
