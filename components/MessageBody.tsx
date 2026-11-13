"use client";

import { useMemo, useState } from "react";

import { parseBlocks, parseInline } from "@/lib/markdown";

type RepoRef = { fullName: string; branch: string; sha: string } | null;

type Segment =
  | { kind: "text"; text: string }
  | { kind: "cite"; text: string; path: string; line: number };

const CITATION = /(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z0-9]{1,8}):(\d{1,6})/g;

/**
 * A citation is a link only when it resolves at the pinned commit.
 *
 * The server passes the paths that exist in that commit, so a model that
 * invents `lib/nope.ts:12` produces text the reader can see is not a link.
 */
function splitCitations(text: string, known: Set<string>): Segment[] {
  const parts: Segment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CITATION)) {
    const path = match[1];
    const line = Number(match[2]);
    const start = match.index ?? 0;

    if (start > cursor) {
      parts.push({ kind: "text", text: text.slice(cursor, start) });
    }

    if (known.has(path) && Number.isFinite(line)) {
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
}

function Citations({
  text,
  repo,
  known,
  chatId,
}: {
  text: string;
  repo: RepoRef;
  known: Set<string>;
  chatId: string;
}) {
  const segments = useMemo(() => splitCitations(text, known), [text, known]);

  return (
    <>
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
            className="rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[12px] text-accent-text no-underline transition-colors [overflow-wrap:anywhere] hover:bg-accent/20"
            title={`Open ${segment.path} at line ${segment.line}`}
          >
            {segment.text}
          </a>
        );
      })}
    </>
  );
}

/** One inline run: emphasis, inline code, links, and citations inside text. */
function InlineRun({
  text,
  repo,
  known,
  chatId,
}: {
  text: string;
  repo: RepoRef;
  known: Set<string>;
  chatId: string;
}) {
  const tokens = useMemo(() => parseInline(text), [text]);

  return (
    <>
      {tokens.map((token, index) => {
        switch (token.kind) {
          case "bold":
            return (
              <strong key={index} className="font-semibold text-hi">
                {token.text}
              </strong>
            );
          case "italic":
            return (
              <em key={index} className="italic">
                {token.text}
              </em>
            );
          case "code":
            return (
              <code
                key={index}
                className="rounded-md border border-line/70 bg-raised px-1.5 py-0.5 font-mono text-[12.5px] text-hi [overflow-wrap:anywhere]"
              >
                {token.text}
              </code>
            );
          case "link":
            return (
              <a
                key={index}
                href={token.href}
                target="_blank"
                rel="noreferrer"
                className="text-accent-text underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
              >
                {token.text}
              </a>
            );
          default:
            return (
              <Citations
                key={index}
                text={token.text}
                repo={repo}
                known={known}
                chatId={chatId}
              />
            );
        }
      })}
    </>
  );
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // A clipboard the browser refuses is not worth an error in the answer.
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-line/70 bg-raised px-3 py-1.5">
        <span className="eyebrow">{lang || "code"}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="thread-tool"
          aria-label="Copy this code block"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-[1.65] text-body">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function Heading({ level, text, known, repo, chatId }: {
  level: 1 | 2 | 3 | 4;
  text: string;
  known: Set<string>;
  repo: RepoRef;
  chatId: string;
}) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";

  return (
    <Tag className="break-words text-hi first:mt-0">
      <InlineRun text={text} repo={repo} known={known} chatId={chatId} />
    </Tag>
  );
}

/**
 * Renders an answer as the structure it was written in.
 *
 * Everything visible is text the page built: no markdown library, no raw HTML.
 * List markers and emphasis are consumed here rather than printed, which is why
 * a `*` bullet no longer reaches the reader as an asterisk.
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
  const blocks = useMemo(() => parseBlocks(content), [content]);
  const known = useMemo(() => new Set(validPaths), [validPaths]);

  return (
    <div className="prose-chat space-y-3 break-words text-[14px] leading-[1.72] text-body">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "code":
            return <CodeBlock key={index} lang={block.lang} text={block.text} />;

          case "heading":
            return (
              <Heading
                key={index}
                level={block.level}
                text={block.text}
                known={known}
                repo={repo}
                chatId={chatId}
              />
            );

          case "bullets":
            return (
              <ul key={index} className="space-y-1.5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="flex gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-[0.62em] size-[5px] shrink-0 rounded-full bg-line-strong"
                    />
                    <span className="min-w-0 flex-1">
                      <InlineRun
                        text={item}
                        repo={repo}
                        known={known}
                        chatId={chatId}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            );

          case "ordered":
            return (
              <ol
                key={index}
                className="list-decimal space-y-1.5 pl-5 marker:font-mono marker:text-[12px] marker:text-low"
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="pl-0.5">
                    <InlineRun
                      text={item}
                      repo={repo}
                      known={known}
                      chatId={chatId}
                    />
                  </li>
                ))}
              </ol>
            );

          case "quote":
            return (
              <blockquote
                key={index}
                className="border-l-2 border-accent/40 pl-3 text-mid"
              >
                <InlineRun
                  text={block.text}
                  repo={repo}
                  known={known}
                  chatId={chatId}
                />
              </blockquote>
            );

          case "rule":
            return <hr key={index} className="border-line" />;

          default:
            return (
              <p key={index} className="whitespace-pre-line">
                <InlineRun
                  text={block.text}
                  repo={repo}
                  known={known}
                  chatId={chatId}
                />
              </p>
            );
        }
      })}
    </div>
  );
}
