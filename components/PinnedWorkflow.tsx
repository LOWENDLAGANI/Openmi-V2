"use client";

import { useState } from "react";

import {
  RUN_MAX_STEPS,
  RUN_MAX_TOKENS,
  RUN_WALL_CLOCK_MS,
} from "@/lib/runs/limits";

type Chapter = {
  id: string;
  index: string;
  title: string;
  body: string;
  panelTitle: string;
  meta: string;
  lines: Array<{ label: string; detail: string; badge: string }>;
};

const CHAPTERS: Chapter[] = [
  {
    id: "connect",
    index: "01",
    title: "Connect a repository",
    body: "Sign in with GitHub OAuth or paste a fine-grained token. Openmi resolves the live branch HEAD and pins every file read to that exact commit SHA.",
    panelTitle: "Repository checkout",
    meta: "AES-256-GCM sealed",
    lines: [
      {
        label: "resolve_head",
        detail: "acme/web-app@main → 9c17d08",
        badge: "pinned",
      },
      {
        label: "read_file",
        detail: "lib/http/next-path.ts (lines 1–64)",
        badge: "≤ 400 lines",
      },
      {
        label: "search_code",
        detail: "ripgrep safeNextPath across workspace",
        badge: "≤ 40 hits",
      },
    ],
  },
  {
    id: "sandbox",
    index: "02",
    title: "Edit and verify in the cloud",
    body: "Each thread gets a persistent Linux sandbox with a 48-hour TTL. Run installs, typechecks, tests, and live previews while observing exact exit codes.",
    panelTitle: "Cloud Linux sandbox",
    meta: "48h checkpoint TTL",
    lines: [
      {
        label: "propose_edits",
        detail: "lib/http/next-path.ts (+3 −1)",
        badge: "unified diff",
      },
      {
        label: "run_command",
        detail: "pnpm exec tsc --noEmit",
        badge: "exit 0",
      },
      {
        label: "preview_url",
        detail: "Live dev server forwarded to browser",
        badge: "ready",
      },
    ],
  },
  {
    id: "ship",
    index: "03",
    title: "Review diffs and ship one PR",
    body: "Openmi commits only to openmi/agent/<id>, opens a single pull request, and never force-pushes or touches your default branch unless you ask.",
    panelTitle: "Isolated pull request",
    meta: "Zero force pushes",
    lines: [
      {
        label: "create_branch",
        detail: "openmi/agent/3a90e4 from 9c17d08",
        badge: "isolated",
      },
      {
        label: "commit_files",
        detail: "2 files changed, 9 insertions(+), 1 deletion(-)",
        badge: "verified",
      },
      {
        label: "open_pr",
        detail: "PR #134 ready for squash-merge",
        badge: "1 PR",
      },
    ],
  },
];

/**
 * Dealt tasteskill moment (`pinned-chapters`): three steps on the left,
 * paired with a live execution trace frame on the right.
 */
export function PinnedWorkflow() {
  const [activeId, setActiveId] = useState<string>(CHAPTERS[0].id);
  const active = CHAPTERS.find((item) => item.id === activeId) ?? CHAPTERS[0];
  const minutes = Math.round(RUN_WALL_CLOCK_MS / 60_000);
  const tokens = `${Math.round(RUN_MAX_TOKENS / 1_000_000)}M`;

  return (
    <div
      data-moment="pinned-chapters"
      className="mt-12 grid items-start gap-10 lg:grid-cols-12"
    >
      <ol className="space-y-2 lg:col-span-5" role="tablist" aria-label="Workflow steps">
        {CHAPTERS.map((chapter) => {
          const isCurrent = chapter.id === active.id;
          return (
            <li key={chapter.id}>
              <button
                type="button"
                role="tab"
                aria-selected={isCurrent}
                onClick={() => setActiveId(chapter.id)}
                className={`w-full rounded-[var(--r-lg)] border p-5 text-left transition-colors ${
                  isCurrent
                    ? "border-line-strong bg-card"
                    : "border-transparent bg-transparent hover:border-line hover:bg-card/60"
                }`}
              >
                <div className="flex items-baseline gap-3">
                  <span
                    className={`font-mono text-[13px] font-medium tabular-nums ${
                      isCurrent ? "text-accent-text" : "text-low"
                    }`}
                  >
                    {chapter.index}
                  </span>
                  <h3 className="text-[19px] font-medium tracking-[-0.02em] text-hi">
                    {chapter.title}
                  </h3>
                </div>
                <p className="mt-2 pl-7 text-[15px] leading-[1.6] text-mid">
                  {chapter.body}
                </p>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="lg:sticky lg:top-24 lg:col-span-7">
        <div className="overflow-hidden rounded-[var(--r-lg)] border border-line-strong bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-raised px-5 py-3.5">
            <span className="font-mono text-[13px] font-medium text-hi">
              {active.panelTitle}
            </span>
            <span className="font-mono text-[12px] text-low">{active.meta}</span>
          </div>

          <ol className="divide-y divide-line">
            {active.lines.map((row) => (
              <li
                key={row.label}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="font-mono text-[13.5px] font-medium text-hi">
                    {row.label}
                  </p>
                  <p className="mt-0.5 text-[14px] text-mid">{row.detail}</p>
                </div>
                <span className="rounded-[var(--r-sm)] border border-line bg-raised px-2.5 py-1 font-mono text-[12px] tabular-nums text-low">
                  {row.badge}
                </span>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-raised px-5 py-3 font-mono text-[12px] text-low">
            <span>Execution ceilings per run</span>
            <span className="tabular-nums text-mid">
              {RUN_MAX_STEPS} steps · {tokens} tokens · {minutes} min
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
