"use client";

import { useMemo } from "react";

type RepoRef = { fullName: string; branch: string; sha: string } | null;

type Segment =
  | { kind: "text"; text: string }
  | { kind: "cite"; text: string; path: string; line: number };

type Block =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string; lang: string };

const CITATION = /(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,8}):(\d{1,6})/g;

/** Split an answer into prose and fenced code, without inventing markdown. */
function splitBlocks(content: string): Block[] {
  if (!content.includes("```")) return [{ kind: "text", text: content }];

  const blocks: Block[] = [];
  const parts = content.split("```");

  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      if (part.length > 0) blocks.push({ kind: "text", text: part });
      return;
    }

    const newline = part.indexOf("\n");
    const lang = newline === -1 ? "" : part.slice(0, newline).trim();
    const body = newline === -1 ? part : part.slice(newline + 1);
    blocks.push({ kind: "code", text: body.replace(/\n$/, ""), lang });
  });

  return blocks;
}

function Prose({
  text,
  repo,
  validPaths,
  chatId,
}: {
  text: string;
  repo: RepoRef;
  validPaths: string[];
  chatId: string;
}) {
  const segments = useMemo(() => {
    const known = new Set(validPaths);
    const parts: Segment[] = [];
    let cursor = 0;

    for (const match of text.matchAll(CITATION)) {
      const path = match[1];
      const line = Number(match[2]);
      const start = match.index ?? 0;

      if (start > cursor) {
        parts.push({ kind: "text", text: text.slice(cursor, start) });
      }

      const resolves = repo !== null && known.has(path) && Number.isFinite(line);

      if (resolves) {
        parts.push({ kind: "cite", text: match[0], path, line });
      } else {
        parts.push({ kind: "text", text: match[0] });
      }

      cursor = start + match[0].length;
    }

    if (cursor < text.length) {
      parts.push({ kind: "text", text: text.slice(cursor) });
    }

    return parts;
  }, [text, repo, validPaths]);

  return (
    <p className="prose-chat whitespace-pre-wrap text-[14px] leading-[1.72] text-body">
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
          <a
            key={index}
            href={`/chat?${params.toString()}`}
            className="rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[12px] text-accent-text no-underline hover:bg-accent/20"
            title={`Open ${segment.path} at line ${segment.line}`}
          >
            {segment.text}
          </a>
        );
      })}
    </p>
  );
}

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
  const blocks = useMemo(() => splitBlocks(content), [content]);

  if (blocks.length === 0) {
    return <p className="prose-chat text-[14px] leading-[1.72] text-body">{content}</p>;
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, index) =>
        block.kind === "code" ? (
          <div key={index} className="overflow-hidden rounded-2xl border border-line">
            <div className="flex items-center justify-between bg-raised px-4 py-1.5">
              <span className="eyebrow">{block.lang || "code"}</span>
              <span className="eyebrow text-low/70">read only</span>
            </div>
            <pre className="overflow-x-auto bg-card px-4 py-3 font-mono text-[12px] leading-[1.65] text-body">
              <code>{block.text}</code>
            </pre>
          </div>
        ) : (
          <Prose
            key={index}
            text={block.text.replace(/^\n+|\n+$/g, "")}
            repo={repo}
            validPaths={validPaths}
            chatId={chatId}
          />
        )
      )}
    </div>
  );
}
