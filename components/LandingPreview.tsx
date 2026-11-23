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
  sandboxStatus?: string;
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
    id: "preview",
    label: "Build pricing & preview",
    repo: "acme/saas-starter",
    sha: "4a8c91e",
    branch: "openmi/agent/7d4e2a",
    pr: "PR #128",
    sandboxStatus: "build exit 0 · preview ready",
    prompt: "Add a yearly billing toggle to the pricing page and verify the build.",
    answer:
      "Added a client billing-period toggle in app/pricing/page.tsx, updated the plan cards to calculate annual savings, and ran pnpm run build in the sandbox (exit 0) with live preview active.",
    citation: "app/pricing/page.tsx:44",
    tools: [
      { tool: "read_file", arg: "app/pricing/page.tsx" },
      { tool: "propose_edits", arg: "app/pricing/page.tsx (+14 −4)" },
      { tool: "run_command", arg: "pnpm run build → exit 0" },
    ],
    files: [
      { path: "app/pricing/page.tsx", adds: 14, dels: 4, active: true },
      { path: "components/PlanToggle.tsx", adds: 28, dels: 0 },
    ],
    hunk: "@@ -40,6 +40,10 @@",
    diff: [
      { kind: "ctx", n: 40, text: "export function PlanPrice({ monthly, yearly }: Props) {" },
      { kind: "del", n: 41, text: "  return <span className=\"font-mono\">${monthly}/mo</span>;" },
      { kind: "add", n: 41, text: "  const amount = yearly ? Math.round(monthly * 0.8) : monthly;" },
      { kind: "add", n: 42, text: "  return (" },
      { kind: "add", n: 43, text: "    <span className=\"font-mono tabular-nums\">" },
      { kind: "add", n: 44, text: "      ${amount}/mo {yearly && \"(billed yearly)\"}" },
      { kind: "add", n: 45, text: "    </span>" },
      { kind: "add", n: 46, text: "  );" },
      { kind: "ctx", n: 47, text: "}" },
    ],
  },
  {
    id: "redirect",
    label: "Fix auth redirect",
    repo: "acme/web-app",
    sha: "9c17d08",
    branch: "openmi/agent/3a90e4",
    pr: "PR #134",
    sandboxStatus: "typecheck exit 0",
    prompt: "Ensure login redirect rejects protocol-relative paths like //evil.com.",
    answer:
      "safeNextPath already normalises against an invalid origin, but protocol-relative strings starting with // pass a naive startsWith check. Rejecting leading double slashes closes that path.",
    citation: "lib/http/next-path.ts:19",
    tools: [
      { tool: "read_file", arg: "lib/http/next-path.ts" },
      { tool: "search_code", arg: "safeNextPath" },
      { tool: "run_command", arg: "pnpm exec tsc --noEmit → exit 0" },
    ],
    files: [
      { path: "lib/http/next-path.ts", adds: 3, dels: 1, active: true },
      { path: "tests/redirect.test.ts", adds: 6, dels: 0 },
    ],
    hunk: "@@ -14,6 +14,8 @@",
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
    id: "webhook",
    label: "Guard webhook route",
    repo: "acme/api-server",
    sha: "08e79f9",
    branch: "openmi/agent/5c12b7",
    pr: "PR #141",
    sandboxStatus: "build exit 0",
    prompt: "Verify webhook signatures with timing-safe comparison before parsing JSON.",
    answer:
      "The handler parsed req.json() before checking the HMAC header and compared signatures with ===. Reading the raw body first and verifying with timingSafeEqual prevents spoofed payloads.",
    citation: "app/api/webhooks/route.ts:22",
    tools: [
      { tool: "read_file", arg: "app/api/webhooks/route.ts" },
      { tool: "search_code", arg: "verifySignature" },
      { tool: "run_command", arg: "pnpm run build → exit 0" },
    ],
    files: [
      { path: "app/api/webhooks/route.ts", adds: 5, dels: 2, active: true },
      { path: "lib/webhooks/verify.ts", adds: 8, dels: 3 },
    ],
    hunk: "@@ -17,6 +17,9 @@",
    diff: [
      { kind: "ctx", n: 17, text: "export async function POST(request: Request) {" },
      { kind: "del", n: 18, text: "  const payload = await request.json();" },
      { kind: "del", n: 19, text: "  if (!verifyHeader(request.headers)) return new Response(null, { status: 401 });" },
      { kind: "add", n: 18, text: "  const rawBody = await request.text();" },
      { kind: "add", n: 19, text: "  const sig = request.headers.get(\"x-signature\") ?? \"\";" },
      { kind: "add", n: 20, text: "  if (!verifySignature(rawBody, sig)) {" },
      { kind: "add", n: 21, text: "    return new Response(\"Invalid signature\", { status: 401 });" },
      { kind: "add", n: 22, text: "  }" },
      { kind: "ctx", n: 23, text: "  const payload = JSON.parse(rawBody);" },
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
            {scenario.sandboxStatus && (
              <span className="hidden rounded-md border border-line bg-card px-2 py-0.5 font-mono text-[10.5px] text-mid lg:inline">
                {scenario.sandboxStatus}
              </span>
            )}
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
