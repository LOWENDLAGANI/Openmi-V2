"use client";

import {
  Check,
  FileCode2,
  GitBranch,
  GitPullRequest,
  Search,
  Terminal,
} from "lucide-react";
import { useState } from "react";

import {
  RUN_MAX_STEPS,
  RUN_MAX_TOKENS,
  RUN_WALL_CLOCK_MS,
} from "@/lib/runs/limits";

type DiffLine = {
  kind: "ctx" | "add" | "del";
  n: number;
  text: string;
};

type Scenario = {
  id: string;
  label: string;
  repo: string;
  sha: string;
  branch: string;
  pr: string;
  prompt: string;
  answer: string;
  citation: string;
  tools: Array<{ tool: string; arg: string }>;
  files: Array<{ path: string; adds: number; dels: number; active?: boolean }>;
  hunk: string;
  diff: DiffLine[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "refunds",
    label: "Fix refund bucket",
    repo: "LOWENDLAGANI/Openmi-V2",
    sha: "612f414",
    branch: "openmi/agent/8f2c1d",
    pr: "PR #412",
    prompt: "A reaped run refunds the wrong bucket. Fix the lookup.",
    answer:
      "The release call omits whether the run was reaped, so a reaped run returns its hour to the default bucket. Passing the flag preserves the original balance target.",
    citation: "lib/refunds.ts:212",
    tools: [
      { tool: "read_file", arg: "lib/refunds.ts" },
      { tool: "search_code", arg: "reaped_at" },
      { tool: "read_file", arg: "supabase/migrations/047_queue_recovery.sql" },
    ],
    files: [
      { path: "lib/refunds.ts", adds: 3, dels: 1, active: true },
      { path: "lib/runs/reaper.ts", adds: 4, dels: 2 },
      { path: "tests/refund.test.ts", adds: 5, dels: 1 },
    ],
    hunk: "@@ -206,7 +206,9 @@",
    diff: [
      { kind: "ctx", n: 206, text: "}" },
      { kind: "ctx", n: 207, text: "" },
      { kind: "del", n: 208, text: "  const bucket = await bucketFor(model);" },
      { kind: "del", n: 209, text: "  await release(run.id, bucket);" },
      { kind: "add", n: 208, text: "  const bucket = await bucketFor(model);" },
      { kind: "add", n: 209, text: "  await release(run.id, bucket, {" },
      { kind: "add", n: 210, text: "    reaped: run.reaped_at !== null," },
      { kind: "add", n: 211, text: "  });" },
      { kind: "ctx", n: 212, text: "}" },
    ],
  },
  {
    id: "redirect",
    label: "Guard next path",
    repo: "LOWENDLAGANI/Openmi-V2",
    sha: "9c17d08",
    branch: "openmi/agent/3a90e4",
    pr: "PR #418",
    prompt: "Ensure login redirect rejects protocol-relative paths.",
    answer:
      "safeNextPath already normalises against an invalid origin, but protocol-relative strings starting with // pass a naive startsWith check. Rejecting leading double slashes closes that path.",
    citation: "lib/http/next-path.ts:19",
    tools: [
      { tool: "read_file", arg: "lib/http/next-path.ts" },
      { tool: "search_code", arg: "safeNextPath" },
      { tool: "run_command", arg: "pnpm exec tsc --noEmit" },
    ],
    files: [
      { path: "lib/http/next-path.ts", adds: 2, dels: 1, active: true },
      { path: "tests/redirect.test.ts", adds: 6, dels: 0 },
    ],
    hunk: "@@ -14,6 +14,7 @@",
    diff: [
      { kind: "ctx", n: 14, text: "export function safeNextPath(raw: string | undefined, base: string) {" },
      { kind: "ctx", n: 15, text: "  if (!raw) return \"/chat\";" },
      { kind: "del", n: 16, text: "  if (!raw.startsWith(\"/\")) return \"/chat\";" },
      { kind: "add", n: 16, text: "  if (!raw.startsWith(\"/\") || raw.startsWith(\"//\")) {" },
      { kind: "add", n: 17, text: "    return \"/chat\";" },
      { kind: "add", n: 18, text: "  }" },
      { kind: "ctx", n: 19, text: "  return new URL(raw, base).pathname;" },
    ],
  },
  {
    id: "effort",
    label: "Check effort default",
    repo: "LOWENDLAGANI/Openmi-V2",
    sha: "08e79f9",
    branch: "openmi/agent/5c12b7",
    pr: "PR #421",
    prompt: "Verify effort gating only forwards levels to DeepSeek models.",
    answer:
      "modelSupportsEffort restricts reasoning_effort to deepseek-flash, and effortOrDefault coerces unknown strings back to high before the provider payload is built.",
    citation: "lib/models/effort.ts:42",
    tools: [
      { tool: "read_file", arg: "lib/models/effort.ts" },
      { tool: "read_file", arg: "lib/providers.ts" },
      { tool: "search_code", arg: "reasoningRequest" },
    ],
    files: [
      { path: "lib/models/effort.ts", adds: 3, dels: 1, active: true },
      { path: "lib/providers.ts", adds: 2, dels: 0 },
    ],
    hunk: "@@ -38,6 +38,8 @@",
    diff: [
      { kind: "ctx", n: 38, text: "export function reasoningRequest(effort: ReasoningEffort) {" },
      { kind: "del", n: 39, text: "  return { reasoning_effort: effort };" },
      { kind: "add", n: 39, text: "  if (effort === \"fast\") {" },
      { kind: "add", n: 40, text: "    return { reasoning_effort: \"none\" as const };" },
      { kind: "add", n: 41, text: "  }" },
      { kind: "add", n: 42, text: "  return { reasoning_effort: effort };" },
      { kind: "ctx", n: 43, text: "}" },
    ],
  },
];

const SIGN: Record<DiffLine["kind"], string> = {
  ctx: " ",
  add: "+",
  del: "−",
};

/**
 * Interactive Openmi workspace workbench rendered directly in HTML/CSS.
 */
export function WorkspaceFrame() {
  const [selectedId, setSelectedId] = useState<string>(SCENARIOS[0].id);
  const scenario =
    SCENARIOS.find((entry) => entry.id === selectedId) ?? SCENARIOS[0];

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Workspace scenarios"
        className="flex flex-wrap items-center gap-1.5"
      >
        {SCENARIOS.map((item) => {
          const active = item.id === scenario.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedId(item.id)}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                active
                  ? "border-line-strong bg-card text-hi shadow-[var(--card-shadow)]"
                  : "border-transparent bg-transparent text-mid hover:bg-hover hover:text-hi"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        role="img"
        aria-label={`The Openmi workspace showing ${scenario.label}. Question, answer citing ${scenario.citation}, tool trace, and unified diff written to ${scenario.branch}.`}
        className="preview-frame"
      >
        {/* Authentic workspace bar — repository, pinned commit, target branch, PR status */}
        <div aria-hidden="true" className="preview-bar justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <GitBranch className="size-3.5 shrink-0 text-mid" strokeWidth={1.75} />
            <span className="truncate font-mono text-[11.5px] font-medium text-hi">
              {scenario.repo}
            </span>
            <span className="hidden rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-low sm:inline">
              {scenario.sha}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden font-mono text-[11px] text-mid md:inline">
              {scenario.branch}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-accent/25 bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] font-medium text-accent-text">
              <GitPullRequest className="size-3" strokeWidth={1.75} />
              {scenario.pr}
            </span>
          </div>
        </div>

        <div
          aria-hidden="true"
          className="grid lg:grid-cols-[200px_1fr_1.15fr]"
        >
          {/* Left file pane */}
          <div className="hidden border-r border-line bg-raised/60 p-3 lg:block">
            <p className="px-2 pb-2 font-mono text-[10.5px] font-medium text-low">
              Changed files ({scenario.files.length})
            </p>
            <ul className="space-y-0.5">
              {scenario.files.map((file) => (
                <li
                  key={file.path}
                  className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] ${
                    file.active
                      ? "bg-card font-medium text-hi shadow-[var(--card-shadow)]"
                      : "text-mid"
                  }`}
                >
                  <span className="truncate">{file.path.split("/").pop()}</span>
                  <span className="shrink-0 tabular-nums text-[10px]">
                    <span className="text-[color:var(--diff-add)]">+{file.adds}</span>{" "}
                    <span className="text-danger">−{file.dels}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Center transcript + citation + tool trace */}
          <div className="flex min-w-0 flex-col justify-between gap-4 border-b border-line p-4 lg:border-b-0 lg:border-r">
            <div className="space-y-3">
              <div className="ml-auto max-w-[28ch] rounded-xl rounded-br-sm bg-bubble px-3 py-2 text-[12px] leading-[1.55] text-bubble-text">
                {scenario.prompt}
              </div>

              <div className="space-y-2">
                <p className="text-[12.5px] leading-[1.6] text-body">
                  {scenario.answer}
                </p>
                <span className="inline-flex items-center gap-1 rounded-md border border-accent/25 bg-accent-soft px-2 py-0.5 font-mono text-[11px] text-accent-text">
                  <FileCode2 className="size-3" strokeWidth={1.75} />
                  {scenario.citation}
                </span>
              </div>
            </div>

            <ol className="space-y-1.5 border-t border-line pt-3">
              {scenario.tools.map((entry, idx) => (
                <li
                  key={`${entry.tool}-${idx}`}
                  className="flex items-center gap-2 font-mono text-[11px] text-low"
                >
                  <Check className="size-3 shrink-0 text-accent-text" strokeWidth={2} />
                  <span className="shrink-0 text-body">{entry.tool}</span>
                  <span className="truncate">{entry.arg}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Right unified diff viewer */}
          <div className="min-w-0 bg-canvas/40 p-3 sm:p-4">
            <div className="overflow-hidden rounded-lg border border-line bg-card">
              <div className="flex items-center justify-between gap-2 border-b border-line bg-raised px-3 py-1.5">
                <span className="truncate font-mono text-[11px] font-medium text-hi">
                  {scenario.files[0]?.path}
                </span>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-low">
                  {scenario.hunk}
                </span>
              </div>

              <div className="py-1.5">
                {scenario.diff.map((line, index) => (
                  <div
                    key={`${line.kind}-${line.n}-${index}`}
                    className={`diff-row ${
                      line.kind === "add"
                        ? "diff-row--add"
                        : line.kind === "del"
                          ? "diff-row--del"
                          : ""
                    }`}
                  >
                    <span className="select-none text-right text-low">{line.n}</span>
                    <span
                      className={`select-none text-center ${
                        line.kind === "add"
                          ? "text-[color:var(--diff-add)]"
                          : line.kind === "del"
                            ? "text-danger"
                            : "text-line-strong"
                      }`}
                    >
                      {SIGN[line.kind]}
                    </span>
                    <span className="whitespace-pre text-body">{line.text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1 text-[11px] font-medium text-hi">
                <Check className="size-3 text-[color:var(--diff-add)]" strokeWidth={2} />
                Written to {scenario.branch}
              </span>
              <span className="font-mono text-[11px] text-low">
                {scenario.pr} opened
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Execution timeline with real caps pulled directly from `lib/runs/limits`.
 */
export function RunTrace() {
  const minutes = Math.round(RUN_WALL_CLOCK_MS / 60_000);
  const tokens = `${Math.round(RUN_MAX_TOKENS / 1_000_000)}M`;

  const steps = [
    {
      icon: FileCode2,
      tool: "read_file",
      arg: "≤ 400 lines",
      note: "Pinned-commit file slice, text only",
    },
    {
      icon: Search,
      tool: "search_code",
      arg: "≤ 40 hits",
      note: "Ripgrep across the checked-out workspace",
    },
    {
      icon: Terminal,
      tool: "run_command",
      arg: "≤ 120 s",
      note: "Sandbox command with observed exit code",
    },
    {
      icon: GitPullRequest,
      tool: "publish",
      arg: "1 branch",
      note: "Unified diff committed to agent branch & PR",
    },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-line-strong bg-card shadow-[var(--card-shadow)]">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-raised px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-mid" strokeWidth={1.75} />
          <span className="font-mono text-[12px] font-medium text-hi">
            Turn execution trace
          </span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-low">
          4 tools · 9.4k tokens
        </span>
      </div>

      <ol className="divide-y divide-line">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.tool}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3"
            >
              <span className="grid size-7 place-items-center rounded-md border border-line bg-raised text-mid">
                <Icon className="size-3.5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-[12.5px] font-medium text-hi">
                  {step.tool}
                </p>
                <p className="truncate text-[12px] text-mid">{step.note}</p>
              </div>
              <span className="rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[11px] tabular-nums text-low">
                {step.arg}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-raised/60 px-4 py-2.5 font-mono text-[11px] text-low">
        <span>Hard execution ceilings</span>
        <span className="tabular-nums text-mid">
          {RUN_MAX_STEPS} steps · {tokens} tokens · {minutes} min
        </span>
      </div>
    </div>
  );
}
