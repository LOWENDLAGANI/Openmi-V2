import {
  ArrowRight,
  Check,
  Code2,
  GitBranch,
  KeyRound,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { RunTrace, WorkspaceFrame } from "@/components/LandingPreview";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  CREDIT_PER_HOUR,
  DAILY_FREE_CREDIT,
  PAID_DAILY_FREE_CREDIT,
  TRIAL_CREDIT,
} from "@/lib/credits";
import { getSession } from "@/lib/session";
import { supportMailto } from "@/lib/support";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Openmi — Repository agent for GitHub",
  description: `Reads your code at a pinned commit, cites verified file paths and line numbers, and writes changes to a dedicated branch. ${CREDIT_PER_HOUR} Credit per hour, ${DAILY_FREE_CREDIT} free every day.`,
  other: { "page-type": "software", "site-kind": "software" },
};

const NAV = [
  { href: "#how", label: "Workflow" },
  { href: "#limits", label: "Boundaries" },
  { href: "#pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

const STEPS = [
  {
    icon: KeyRound,
    title: "Connect a repository",
    body: "Authenticate with GitHub OAuth or a fine-grained token and select a branch. Every turn runs against the exact commit SHA where the conversation started.",
  },
  {
    icon: Code2,
    title: "Inspect with verified citations",
    body: "The agent lists paths, searches with ripgrep, reads files in bounded slices, and links claims to files and lines present in that commit.",
  },
  {
    icon: GitBranch,
    title: "Publish to an isolated branch",
    body: "File edits arrive as unified diffs against the pinned commit. At the end of a turn, Openmi writes a dedicated branch, opens one pull request, and names both.",
  },
];

const BOUNDARIES = [
  {
    title: "Never forces or rewrites branches",
    body: "Changes write to openmi/agent/<id> unless you specify another destination. If the base moves, edits re-apply cleanly or move to a fresh branch.",
  },
  {
    title: "Never touches your default branch unasked",
    body: "Your default branch stays protected as the pull request base unless you explicitly choose it as the destination.",
  },
  {
    title: "Never fabricates test execution",
    body: "Sandboxes run installs, builds, and commands you request and report the exact exit code observed. If a test suite did not run, the transcript never claims it did.",
  },
  {
    title: "Never stores card details in the app",
    body: "Credit arrives through the daily allowance, trial grants, or approved top-ups via our hosted payment link. Every change to your balance stays in an append-only ledger.",
  },
];

export default async function HomePage() {
  const session = await getSession();
  if (session.state === "signed-in") redirect("/chat");

  return (
    <div className="lp min-h-dvh">
      <a
        href="#main"
        className="sr-only rounded-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:border focus:border-line-strong focus:bg-card focus:px-4 focus:py-2 focus:text-[13px] focus:text-hi"
      >
        Skip to content
      </a>

      <header className="glass fixed inset-x-0 top-0 z-50 border-b border-line">
        <div className="lp-wrap flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-8">
            <Link href="/" aria-label="Openmi home" className="shrink-0">
              <Brand compact />
            </Link>

            <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-[13px] font-medium text-mid transition-colors hover:text-hi"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link
              href="/login"
              className="btn btn-quiet hidden px-3 py-1.5 text-[13px] sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/login"
              className="btn btn-primary px-3.5 py-1.5 text-[13px]"
            >
              Start with GitHub
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ── Hero + Interactive Workbench ───────────────────────────────── */}
        <section className="pb-16 pt-24 sm:pb-24 sm:pt-32">
          <div className="lp-wrap">
            <div className="grid items-end gap-8 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <h1 className="max-w-[19ch] text-balance text-[clamp(2.35rem,5.2vw,4rem)] font-semibold leading-[1.03] tracking-[-0.035em] text-hi">
                  Codebase agent built for GitHub branches.
                </h1>
                <p className="mt-5 max-w-[54ch] text-pretty text-[15.5px] leading-[1.65] text-mid">
                  Openmi reads your repository at a pinned commit, cites real
                  files and line numbers, and ships edits on an isolated branch
                  with an open pull request.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link
                    href="/login"
                    className="btn btn-primary lift px-5 py-2.5 text-[13.5px]"
                  >
                    Start with GitHub
                    <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  </Link>
                  <a
                    href="#how"
                    className="btn px-4 py-2.5 text-[13.5px]"
                  >
                    See how a turn runs
                  </a>
                </div>
              </div>

              <div className="lg:col-span-4">
                <dl className="grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-card shadow-[var(--card-shadow)]">
                  <div className="px-3.5 py-3">
                    <dt className="text-[11.5px] text-low">Per hour</dt>
                    <dd className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-hi">
                      {CREDIT_PER_HOUR} Credit
                    </dd>
                  </div>
                  <div className="px-3.5 py-3">
                    <dt className="text-[11.5px] text-low">Daily free</dt>
                    <dd className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-hi">
                      {DAILY_FREE_CREDIT} Credit
                    </dd>
                  </div>
                  <div className="px-3.5 py-3">
                    <dt className="text-[11.5px] text-low">Auto mode</dt>
                    <dd className="mt-1 font-mono text-[14px] font-semibold text-hi">
                      Free
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="mt-10 animate-enter sm:mt-12">
              <WorkspaceFrame />
            </div>
          </div>
        </section>

        {/* ── Workflow + Execution Trace ─────────────────────────────────── */}
        <section id="how" className="lp-section border-t border-line">
          <div className="lp-wrap grid items-start gap-12 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                How every turn runs
              </h2>
              <p className="mt-4 text-[14.5px] leading-[1.65] text-mid">
                Each turn operates inside a sandbox seeded from your pinned
                commit. Your GitHub token stays sealed on the server—the model
                never sees credentials.
              </p>

              <ol className="mt-8 space-y-5">
                {STEPS.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <li key={step.title} className="flex gap-3.5">
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-card text-accent-text shadow-[var(--card-shadow)]">
                        <Icon className="size-4" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="flex items-center gap-2 text-[14.5px] font-semibold tracking-[-0.015em] text-hi">
                          <span className="font-mono text-[11px] font-medium tabular-nums text-low">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          {step.title}
                        </h3>
                        <p className="mt-1 text-pretty text-[13.5px] leading-[1.6] text-mid">
                          {step.body}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="lg:col-span-7">
              <RunTrace />
              <p className="mt-3 text-[12px] leading-relaxed text-low">
                Turn execution limits are enforced server-side across steps,
                tokens, and wall-clock time.
              </p>
            </div>
          </div>
        </section>

        {/* ── Operational Boundaries Matrix ──────────────────────────────── */}
        <section id="limits" className="lp-section border-y border-line bg-raised">
          <div className="lp-wrap">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                  Explicit operational boundaries
                </h2>
                <p className="mt-3 max-w-[54ch] text-pretty text-[14.5px] leading-[1.65] text-mid">
                  Every transcript states what ran and what stayed untouched,
                  with clear constraints enforced before a write reaches GitHub.
                </p>
              </div>
              <Link href="/about" className="btn self-start px-3.5 py-2 text-[12.5px]">
                Read full contract
              </Link>
            </div>

            <dl className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
              {BOUNDARIES.map((item) => (
                <div key={item.title} className="bg-card p-6 sm:p-7">
                  <dt className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.015em] text-hi">
                    <ShieldAlert
                      aria-hidden="true"
                      className="size-4 shrink-0 text-accent-text"
                      strokeWidth={1.75}
                    />
                    {item.title}
                  </dt>
                  <dd className="mt-2.5 text-pretty text-[13.5px] leading-[1.6] text-mid">
                    {item.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Transparent Hourly Billing ─────────────────────────────────── */}
        <section id="pricing" className="lp-section">
          <div className="lp-wrap grid items-start gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                {CREDIT_PER_HOUR} Credit per hour, or free on Auto
              </h2>
              <p className="mt-4 text-[14.5px] leading-[1.65] text-mid">
                An active hour belongs to the conversation that started it. Send
                follow-up turns inside that hour at zero extra charge.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-low">
                No automatic renewals. When a pass expires, your account simply
                returns to the {DAILY_FREE_CREDIT} Credit daily allowance.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link href="/pay" className="btn btn-primary px-4 py-2 text-[13px]">
                  Compare passes
                </Link>
                <a
                  href={supportMailto("Credit question")}
                  className="btn px-4 py-2 text-[13px]"
                >
                  Ask about Credit
                </a>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
              <div className="rounded-xl border border-line bg-card p-6 shadow-[var(--card-shadow)]">
                <p className="text-[13px] font-medium text-mid">Free daily tier</p>
                <p className="mt-3 font-mono text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-hi">
                  {DAILY_FREE_CREDIT}{" "}
                  <span className="font-sans text-[13px] font-medium text-low">
                    Credit / day
                  </span>
                </p>
                <ul className="mt-5 space-y-2.5 border-t border-line pt-4 text-[13px] text-mid">
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>{TRIAL_CREDIT} Credit one-time trial grant</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Auto routing included at zero cost</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>{CREDIT_PER_HOUR} Credit per hour on standard models</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-accent/35 bg-card p-6 shadow-[var(--card-shadow)]">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-accent-text">
                    With an active pass
                  </p>
                  <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[10.5px] font-medium text-accent-text">
                    No auto-renew
                  </span>
                </div>
                <p className="mt-3 font-mono text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-hi">
                  {PAID_DAILY_FREE_CREDIT}{" "}
                  <span className="font-sans text-[13px] font-medium text-low">
                    Credit / day
                  </span>
                </p>
                <ul className="mt-5 space-y-2.5 border-t border-line pt-4 text-[13px] text-mid">
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Higher daily allowance plus wallet Credit</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Access to flagship coding &amp; reasoning models</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Fixed duration—ends cleanly without recurring billing</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── Closing CTA ────────────────────────────────────────────────── */}
        <section className="border-t border-line py-16 sm:py-20">
          <div className="lp-wrap flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-balance text-[clamp(1.6rem,3vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                Connect your repository and start a thread.
              </h2>
              <p className="mt-2.5 text-[14px] text-mid">
                Sign in with GitHub and run your first turn using your daily
                allowance.
              </p>
            </div>
            <Link
              href="/login"
              className="btn btn-primary lift shrink-0 px-5 py-2.5 text-[13.5px]"
            >
              Start with GitHub
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </Link>
          </div>
        </section>
      </main>

      {/* ── Structured Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-line bg-raised py-12">
        <div className="lp-wrap">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-3">
              <Brand compact />
              <p className="max-w-[28ch] text-[12.5px] leading-relaxed text-low">
                Repository agent for GitHub. Verified line citations and
                isolated branch pull requests.
              </p>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-hi">Product</p>
              <ul className="mt-3 space-y-2 text-[13px] text-mid">
                <li>
                  <Link href="/login" className="hover:text-hi">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href="/pay" className="hover:text-hi">
                    Pricing &amp; passes
                  </Link>
                </li>
                <li>
                  <Link href="/about" className="hover:text-hi">
                    About &amp; boundaries
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-hi">Legal</p>
              <ul className="mt-3 space-y-2 text-[13px] text-mid">
                <li>
                  <Link href="/terms" className="hover:text-hi">
                    Terms of service
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="hover:text-hi">
                    Privacy policy
                  </Link>
                </li>
                <li>
                  <Link href="/refunds" className="hover:text-hi">
                    Refunds &amp; cancellation
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-hi">Support</p>
              <ul className="mt-3 space-y-2 text-[13px] text-mid">
                <li>
                  <a
                    href={supportMailto("Support")}
                    className="hover:text-hi"
                  >
                    Email support
                  </a>
                </li>
                <li>
                  <Link href="/account/delete" className="hover:text-hi">
                    Delete account
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
            <p className="font-mono text-[11.5px] text-low">© 2026 Openmi</p>
            <ThemeSwitcher />
          </div>
        </div>
      </footer>
    </div>
  );
}
