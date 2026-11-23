import {
  ArrowRight,
  Check,
  Clock,
  Code2,
  Cpu,
  GitBranch,
  Globe,
  KeyRound,
  Layers,
  Rocket,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { RunTrace, WorkspaceFrame } from "@/components/LandingPreview";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { PLANS } from "@/lib/billing/plans";
import {
  CREDIT_PER_HOUR,
  DAILY_FREE_CREDIT,
  INVITE_REWARD_CREDIT,
  PAID_DAILY_FREE_CREDIT,
  TRIAL_CREDIT,
} from "@/lib/credits";
import { getSession } from "@/lib/session";
import { supportMailto } from "@/lib/support";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Openmi — Free GitHub coding agent, priced by the hour",
  description: `Ad-supported browser coding agent for GitHub with cloud sandboxes, live previews, and isolated pull requests. Free on Auto, ${DAILY_FREE_CREDIT} free Credit every day, or ${CREDIT_PER_HOUR} Credit per hour on named models.`,
  other: { "page-type": "software", "site-kind": "software" },
};

const NAV = [
  { href: "#why", label: "Why Openmi" },
  { href: "#features", label: "Features" },
  { href: "#how", label: "Workflow" },
  { href: "#pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

const HIGHLIGHTS = [
  {
    icon: Clock,
    title: "Billed by the hour, never per token",
    body: `${CREDIT_PER_HOUR} Credit unlocks a full hour on a named model with unlimited follow-up turns in that chat. Provider failures before the first token refund automatically.`,
  },
  {
    icon: Globe,
    title: "Free every day, equal worldwide",
    body: `Auto mode is free, and every account refills to ${DAILY_FREE_CREDIT} Credit at local midnight—the same daily allowance in every country, funded by ads.`,
  },
  {
    icon: Layers,
    title: "Zero subscription lock-in",
    body: "No monthly auto-renewal and no credit card stored in the app. Pick up a fixed-term pass when you need extra hours; it ends cleanly back on the free tier.",
  },
  {
    icon: Terminal,
    title: "Zero local setup required",
    body: "Connect a GitHub repository from any browser, run builds in a persistent Linux sandbox, preview live apps, and merge pull requests from one place.",
  },
];

const FEATURES = [
  {
    icon: KeyRound,
    title: "GitHub OAuth & sealed tokens",
    body: "Connect with GitHub OAuth or a fine-grained personal access token. Credentials stay encrypted server-side with AES-256-GCM; the model never sees them.",
  },
  {
    icon: Terminal,
    title: "Persistent cloud Linux sandbox",
    body: "Each chat gets its own isolated sandbox seeded from your pinned commit—kept for 48 hours of inactivity with shell tools, browser inspection, and checkpoints.",
  },
  {
    icon: Rocket,
    title: "Live previews & Vercel publish",
    body: "Preview running web apps directly from the chat sandbox, sync workspace edits back to GitHub, and deploy commits straight to Vercel.",
  },
  {
    icon: Cpu,
    title: "Multi-model router & effort control",
    body: "Auto routes across coding, reasoning, search, and vision models at zero cost. Switch to DeepSeek V4.1 Flash (Fast, High, or Max effort), GPT-OSS 120B, or Claude Haiku 4.5.",
  },
  {
    icon: GitBranch,
    title: "Unified diffs & isolated PRs",
    body: "Review per-file unified diffs pinned to an exact commit SHA. Approved changes write to openmi/agent/<id> and open a pull request without force-pushing.",
  },
  {
    icon: Code2,
    title: "Verified line citations & ledger",
    body: "Every code claim cites real paths and line numbers from the pinned commit, and every Credit charge, refill, or refund appears in an append-only ledger.",
  },
];

const STEPS = [
  {
    icon: KeyRound,
    title: "Connect a GitHub repository",
    body: "Sign in, connect via GitHub OAuth or a fine-grained token, and pick a branch. Every turn runs against the exact commit SHA where the thread started.",
  },
  {
    icon: Terminal,
    title: "Inspect, edit, and build in the cloud",
    body: "The agent searches your codebase with ripgrep, edits files in a persistent Linux sandbox, runs installs and builds, and cites real paths and line numbers.",
  },
  {
    icon: GitBranch,
    title: "Preview and ship on an isolated branch",
    body: "Check live previews or review per-file unified diffs. Openmi writes a dedicated branch, opens one pull request, and lets you deploy to Vercel when ready.",
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
    body: "Credit arrives through the daily allowance, trial grants, invites, or approved fixed-term passes via hosted checkout. Every balance change stays in an append-only ledger.",
  },
];

export default async function HomePage() {
  const session = await getSession();
  if (session.state === "signed-in") redirect("/chat");

  const dailyFreeHours = Math.floor(DAILY_FREE_CREDIT / CREDIT_PER_HOUR);
  const paidDailyHours = Math.floor(PAID_DAILY_FREE_CREDIT / CREDIT_PER_HOUR);

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
              Start free
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
                <div className="inline-flex flex-wrap items-center gap-2 rounded-md border border-line bg-card px-2.5 py-1 text-[12px] text-mid shadow-[var(--card-shadow)]">
                  <span className="font-mono font-medium text-accent-text">
                    Ad-supported free tier
                  </span>
                  <span aria-hidden="true" className="text-line-strong">
                    ·
                  </span>
                  <span>No credit card</span>
                  <span aria-hidden="true" className="text-line-strong">
                    ·
                  </span>
                  <span>No API keys</span>
                </div>

                <h1 className="mt-4 max-w-[20ch] text-balance text-[clamp(2.35rem,5.2vw,4rem)] font-semibold leading-[1.03] tracking-[-0.035em] text-hi">
                  Free GitHub coding agent, priced by the hour.
                </h1>
                <p className="mt-5 max-w-[56ch] text-pretty text-[15.5px] leading-[1.65] text-mid">
                  Skip the $20/mo subscription and token meters. Connect a
                  GitHub repository, run builds in a cloud Linux sandbox,
                  preview live apps, and ship verified pull requests—free on
                  Auto, with {DAILY_FREE_CREDIT} free Credit every day.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link
                    href="/login"
                    className="btn btn-primary lift px-5 py-2.5 text-[13.5px]"
                  >
                    Start free with GitHub
                    <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  </Link>
                  <a
                    href="#pricing"
                    className="btn px-4 py-2.5 text-[13.5px]"
                  >
                    Free vs. passes
                  </a>
                </div>
              </div>

              <div className="lg:col-span-4">
                <dl className="grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-card shadow-[var(--card-shadow)]">
                  <div className="px-3.5 py-3">
                    <dt className="text-[11.5px] text-low">Auto mode</dt>
                    <dd className="mt-1 font-mono text-[14px] font-semibold text-hi">
                      Free
                    </dd>
                    <p className="mt-0.5 text-[11px] text-low">0 Credit/hr</p>
                  </div>
                  <div className="px-3.5 py-3">
                    <dt className="text-[11.5px] text-low">Daily free</dt>
                    <dd className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-hi">
                      {DAILY_FREE_CREDIT} Credit
                    </dd>
                    <p className="mt-0.5 text-[11px] text-low">
                      {dailyFreeHours} hrs/day
                    </p>
                  </div>
                  <div className="px-3.5 py-3">
                    <dt className="text-[11.5px] text-low">Named hour</dt>
                    <dd className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-hi">
                      {CREDIT_PER_HOUR} Credit
                    </dd>
                    <p className="mt-0.5 text-[11px] text-low">
                      Unlimited turns
                    </p>
                  </div>
                </dl>
              </div>
            </div>

            <div className="mt-10 animate-enter sm:mt-12">
              <WorkspaceFrame />
            </div>
          </div>
        </section>

        {/* ── Why Openmi (Anti-Token-Anxiety & Global Fairness) ──────────── */}
        <section id="why" className="lp-section border-t border-line bg-raised">
          <div className="lp-wrap">
            <div className="max-w-2xl">
              <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                Unlimited follow-ups per hour, without the monthly trap
              </h2>
              <p className="mt-3 text-pretty text-[14.5px] leading-[1.65] text-mid">
                Other coding agents meter every prompt and lock cloud sandboxes
                behind $20–$200 monthly subscriptions. Openmi keeps the free
                tier genuinely usable every day and charges by the hour when you
                pick a named model.
              </p>
            </div>

            <dl className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {HIGHLIGHTS.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="bg-card p-6">
                    <span className="grid size-8 place-items-center rounded-lg border border-line bg-raised text-accent-text">
                      <Icon className="size-4" strokeWidth={1.75} />
                    </span>
                    <dt className="mt-4 text-[14.5px] font-semibold tracking-[-0.015em] text-hi">
                      {item.title}
                    </dt>
                    <dd className="mt-2 text-pretty text-[13px] leading-[1.6] text-mid">
                      {item.body}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </section>

        {/* ── Full Feature Surface ───────────────────────────────────────── */}
        <section id="features" className="lp-section border-t border-line">
          <div className="lp-wrap">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                  Everything needed to go from repo to PR in the browser
                </h2>
                <p className="mt-3 max-w-[58ch] text-pretty text-[14.5px] leading-[1.65] text-mid">
                  Built directly around GitHub commits, persistent Linux
                  sandboxes, and reviewable diffs—usable on desktop or mobile
                  with PWA install support.
                </p>
              </div>
              <Link href="/login" className="btn self-start px-3.5 py-2 text-[12.5px]">
                Open workspace
              </Link>
            </div>

            <dl className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-xl border border-line bg-card p-6 shadow-[var(--card-shadow)]"
                  >
                    <dt className="flex items-center gap-2.5 text-[14.5px] font-semibold tracking-[-0.015em] text-hi">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-raised text-accent-text">
                        <Icon className="size-3.5" strokeWidth={1.75} />
                      </span>
                      {item.title}
                    </dt>
                    <dd className="mt-3 text-pretty text-[13px] leading-[1.6] text-mid">
                      {item.body}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </section>

        {/* ── Workflow + Execution Trace ─────────────────────────────────── */}
        <section id="how" className="lp-section border-t border-line bg-raised">
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
        <section id="limits" className="lp-section border-y border-line">
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

        {/* ── Transparent Hourly Billing & Passes ────────────────────────── */}
        <section id="pricing" className="lp-section bg-raised">
          <div className="lp-wrap grid items-start gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                Free every day. Upgrade only when you need more hours.
              </h2>
              <p className="mt-4 text-[14.5px] leading-[1.65] text-mid">
                Auto mode is free, and a named model costs {CREDIT_PER_HOUR}{" "}
                Credit for a full hour of unlimited follow-up turns in that
                conversation. Ads fund the daily free tier so you never need a
                credit card to start.
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-low">
                Fixed-term passes never auto-renew. When a pass expires, your
                account simply returns to the {DAILY_FREE_CREDIT} Credit daily
                allowance. Invite friends to earn +{INVITE_REWARD_CREDIT} Credit
                for both accounts.
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
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-mid">Free tier</p>
                  <span className="rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[10.5px] font-medium text-mid">
                    Ad-supported
                  </span>
                </div>
                <p className="mt-3 font-mono text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-hi">
                  {DAILY_FREE_CREDIT}{" "}
                  <span className="font-sans text-[13px] font-medium text-low">
                    Credit / day
                  </span>
                </p>
                <p className="mt-1.5 text-[12px] text-low">
                  {dailyFreeHours} hours/day on named models · same worldwide
                </p>
                <ul className="mt-5 space-y-2.5 border-t border-line pt-4 text-[13px] text-mid">
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Unlimited Auto mode (0 Credit/hr)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>
                      {TRIAL_CREDIT} Credit trial + {INVITE_REWARD_CREDIT} Credit
                      per invite
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>DeepSeek V4.1 Flash &amp; GPT-OSS 120B included</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Cloud sandbox, live previews &amp; GitHub PRs</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-accent/35 bg-card p-6 shadow-[var(--card-shadow)]">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-accent-text">
                    Fixed-term passes
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
                <p className="mt-1.5 text-[12px] text-low">
                  {paidDailyHours} hours/day · plus upfront wallet Credit
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {PLANS.map((plan) => (
                    <div
                      key={plan.id}
                      className="rounded-lg border border-line bg-raised px-3 py-2"
                    >
                      <p className="text-[11.5px] font-medium text-mid">
                        {plan.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-hi">
                        RM {plan.price}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-accent-text">
                        +{plan.credit} Credit
                      </p>
                    </div>
                  ))}
                </div>

                <ul className="mt-4 space-y-2.5 border-t border-line pt-4 text-[13px] text-mid">
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Unlocks paid-only models (Claude Haiku 4.5)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Stackable—extends from your current end date</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Ends cleanly with zero recurring billing</span>
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
                Stop paying per token. Ship on GitHub for free.
              </h2>
              <p className="mt-2.5 text-[14px] text-mid">
                Connect your repository in seconds—start with Auto mode for free
                and {DAILY_FREE_CREDIT} Credit every day.
              </p>
            </div>
            <Link
              href="/login"
              className="btn btn-primary lift shrink-0 px-5 py-2.5 text-[13.5px]"
            >
              Start free with GitHub
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
                Free GitHub coding agent priced by the hour. Verified line
                citations, cloud sandboxes, and isolated pull requests.
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
