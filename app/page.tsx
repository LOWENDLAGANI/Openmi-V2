import {
  ArrowRight,
  Check,
  Clock,
  Cpu,
  GitBranch,
  KeyRound,
  Rocket,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { RunTrace, WorkspaceFrame } from "@/components/LandingPreview";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { VersionBadge } from "@/components/VersionBadge";
import { PLANS } from "@/lib/billing/plans";
import {
  CREDIT_PER_HOUR,
  DAILY_FREE_CREDIT,
  INVITE_REWARD_CREDIT,
  PAID_DAILY_FREE_CREDIT,
  TRIAL_CREDIT,
} from "@/lib/credits";
import {
  faqJsonLd,
  organizationJsonLd,
  pageMetadata,
  pricingOffersJsonLd,
  SITE_TITLE,
  serializeJsonLd,
} from "@/lib/seo";
import { getSession } from "@/lib/session";
import { supportMailto } from "@/lib/support";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  path: "/",
  title: SITE_TITLE,
  description: `Browser GitHub agent with cloud sandboxes, live previews, and isolated PRs. ${DAILY_FREE_CREDIT} free Credit daily, ${CREDIT_PER_HOUR} Credit/hr.`,
  other: { "page-type": "software", "site-kind": "software" },
});

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "Workflow" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

const FEATURES = [
  {
    icon: Clock,
    title: "Hourly billing",
    body: `${CREDIT_PER_HOUR} Credit/hr, unlimited follow-ups. Auto-refund on failure.`,
  },
  {
    icon: Terminal,
    title: "Cloud Linux sandbox",
    body: "Persistent per-chat shell, browser tool, and checkpoints (48h TTL).",
  },
  {
    icon: Rocket,
    title: "Previews & Vercel deploy",
    body: "Live sandbox previews, GitHub sync, and one-click Vercel publish.",
  },
  {
    icon: Cpu,
    title: "Top coding models",
    body: "DeepSeek V4.1 Flash (Fast/High/Max), GPT-OSS 120B, Claude Haiku 4.5.",
  },
  {
    icon: GitBranch,
    title: "Diffs & isolated PRs",
    body: "Pinned-commit citations, per-file diffs, openmi/agent/ branches.",
  },
  {
    icon: KeyRound,
    title: "Sealed GitHub access",
    body: "OAuth or fine-grained tokens encrypted server-side (AES-256-GCM).",
  },
];

const STEPS = [
  {
    icon: KeyRound,
    title: "Connect a repo",
    body: "GitHub OAuth or token. Pinned to the exact commit SHA.",
  },
  {
    icon: Terminal,
    title: "Code & build in cloud",
    body: "ripgrep search, file edits, installs, and live previews.",
  },
  {
    icon: GitBranch,
    title: "Review & ship PR",
    body: "Unified diffs on openmi/agent/<id> plus one pull request.",
  },
];

const BOUNDARIES = [
  {
    title: "No force pushes",
    body: "Never rewrites history or overwrites moved branches.",
  },
  {
    title: "Protected default branch",
    body: "Writes to openmi/agent/<id> unless you name another branch.",
  },
  {
    title: "Real exit codes only",
    body: "Reports exact sandbox exit codes. Never fakes test runs.",
  },
  {
    title: "No cards stored",
    body: "Fixed passes via hosted checkout. Append-only Credit ledger.",
  },
];

const HOME_FAQS = [
  {
    question: "How much does Openmi cost per hour?",
    answer: `Every named model costs ${CREDIT_PER_HOUR} Credit per hour with unlimited follow-up turns inside that active hour, and Auto is 0 Credit/hr. Free accounts receive ${DAILY_FREE_CREDIT} free Credit every day (${Math.floor(DAILY_FREE_CREDIT / CREDIT_PER_HOUR)} hrs/day) plus a ${TRIAL_CREDIT} Credit trial grant on the first turn.`,
  },
  {
    question: "Do Openmi paid passes auto-renew?",
    answer: `No. Fixed-term passes (${PLANS.map((p) => `${p.name} at RM ${p.price}`).join(" and ")}) raise your daily allowance to ${PAID_DAILY_FREE_CREDIT} Credit/day, add upfront wallet Credit, unlock Claude Haiku 4.5, and end cleanly without recurring charges.`,
  },
  {
    question: "Does Openmi write directly to my default GitHub branch?",
    answer:
      "No. Openmi reads files at the pinned commit SHA, writes unified diffs to an isolated openmi/agent/<id> branch, opens one pull request, and never force-pushes unless you explicitly name another branch.",
  },
  {
    question: "What happens if a model provider fails to respond?",
    answer:
      "If the model provider returns no answer before the first token, Openmi automatically releases the hour charge back to your Credit balance in the append-only ledger.",
  },
] as const;

function cleanRef(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  return /^[A-Za-z0-9_-]{3,32}$/.test(value) ? value : null;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const session = await getSession();
  if (session.state === "signed-in") redirect("/chat");

  const params = await searchParams;
  const ref = cleanRef(params.ref);
  const loginHref = ref ? `/login?ref=${encodeURIComponent(ref)}` : "/login";
  const pricingHref = ref ? `/pricing?ref=${encodeURIComponent(ref)}` : "/pricing";

  const dailyFreeHours = Math.floor(DAILY_FREE_CREDIT / CREDIT_PER_HOUR);
  const paidDailyHours = Math.floor(PAID_DAILY_FREE_CREDIT / CREDIT_PER_HOUR);

  return (
    <div className="lp min-h-dvh">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd([
            organizationJsonLd(),
            pricingOffersJsonLd(),
            faqJsonLd(HOME_FAQS),
          ]),
        }}
      />
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
              href={loginHref}
              className="btn btn-quiet hidden px-3 py-1.5 text-[13px] sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href={loginHref}
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
            {ref && (
              <div
                role="status"
                className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-[13px] text-accent-text"
              >
                <p>
                  Invite{" "}
                  <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[12px] text-hi">
                    {ref}
                  </code>{" "}
                  active: +{INVITE_REWARD_CREDIT} Credit for both on first paid
                  pass.
                </p>
                <Link
                  href={loginHref}
                  className="btn btn-primary px-3 py-1.5 text-[12px]"
                >
                  Apply code
                </Link>
              </div>
            )}

            <div className="grid items-end gap-8 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <div className="inline-flex flex-wrap items-center gap-2 rounded-md border border-line bg-card px-2.5 py-1 text-[12px] text-mid shadow-[var(--card-shadow)]">
                  <span className="font-mono font-medium text-accent-text">
                    Ad-supported free tier
                  </span>
                  <span aria-hidden="true" className="text-line-strong">
                    ·
                  </span>
                  <span>No card</span>
                  <span aria-hidden="true" className="text-line-strong">
                    ·
                  </span>
                  <span>No API keys</span>
                </div>

                <h1 className="mt-4 max-w-[20ch] text-balance text-[clamp(2.35rem,5.2vw,4rem)] font-semibold leading-[1.03] tracking-[-0.035em] text-hi">
                  Free GitHub coding agent, priced by the hour.
                </h1>
                <p className="mt-4 max-w-[48ch] text-pretty text-[15.5px] leading-[1.6] text-mid">
                  Cloud Linux sandboxes, live previews, and isolated PRs, with{" "}
                  {DAILY_FREE_CREDIT} free Credit every day.
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Link
                    href={loginHref}
                    className="btn btn-primary lift px-5 py-2.5 text-[13.5px]"
                  >
                    Start free with GitHub
                    <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  </Link>
                  <Link
                    href={pricingHref}
                    className="btn px-4 py-2.5 text-[13.5px]"
                  >
                    Pricing
                  </Link>
                </div>
              </div>

              <div className="lg:col-span-4">
                <dl className="grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-card shadow-[var(--card-shadow)]">
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
                    <dt className="text-[11.5px] text-low">Per hour</dt>
                    <dd className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-hi">
                      {CREDIT_PER_HOUR} Credit
                    </dd>
                    <p className="mt-0.5 text-[11px] text-low">
                      Unlimited turns
                    </p>
                  </div>
                  <div className="px-3.5 py-3">
                    <dt className="text-[11.5px] text-low">Trial</dt>
                    <dd className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-hi">
                      {TRIAL_CREDIT} Credit
                    </dd>
                    <p className="mt-0.5 text-[11px] text-low">First turn</p>
                  </div>
                </dl>
              </div>
            </div>

            <div className="mt-10 animate-enter sm:mt-12">
              <WorkspaceFrame />
            </div>
          </div>
        </section>

        {/* ── Features ───────────────────────────────────────────────────── */}
        <section id="features" className="lp-section border-t border-line bg-raised">
          <div className="lp-wrap">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                Repo to PR, in the browser
              </h2>
              <Link href={loginHref} className="btn self-start px-3.5 py-2 text-[12.5px]">
                Open workspace
              </Link>
            </div>

            <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-xl border border-line bg-card p-5 shadow-[var(--card-shadow)]"
                  >
                    <dt className="flex items-center gap-2.5 text-[14px] font-semibold tracking-[-0.015em] text-hi">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-raised text-accent-text">
                        <Icon className="size-3.5" strokeWidth={1.75} />
                      </span>
                      {item.title}
                    </dt>
                    <dd className="mt-2 text-pretty text-[13px] leading-[1.55] text-mid">
                      {item.body}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </section>

        {/* ── Workflow + Execution Trace ─────────────────────────────────── */}
        <section id="how" className="lp-section border-t border-line">
          <div className="lp-wrap grid items-start gap-12 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                How a turn runs
              </h2>

              <ol className="mt-7 space-y-5">
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
                        <p className="mt-1 text-pretty text-[13px] leading-[1.55] text-mid">
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
            </div>
          </div>
        </section>

        {/* ── Boundaries ─────────────────────────────────────────────────── */}
        <section id="limits" className="lp-section border-y border-line bg-raised">
          <div className="lp-wrap">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                Hard boundaries
              </h2>
              <Link href="/about" className="btn self-start px-3.5 py-2 text-[12.5px]">
                Full contract
              </Link>
            </div>

            <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {BOUNDARIES.map((item) => (
                <div key={item.title} className="bg-card p-5">
                  <dt className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.015em] text-hi">
                    <ShieldAlert
                      aria-hidden="true"
                      className="size-4 shrink-0 text-accent-text"
                      strokeWidth={1.75}
                    />
                    {item.title}
                  </dt>
                  <dd className="mt-2 text-pretty text-[13px] leading-[1.55] text-mid">
                    {item.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Pricing ────────────────────────────────────────────────────── */}
        <section id="pricing" className="lp-section">
          <div className="lp-wrap grid items-start gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                {CREDIT_PER_HOUR} Credit/hr. Zero subscriptions.
              </h2>
              <p className="mt-3 text-[14px] leading-[1.6] text-mid">
                Unlimited follow-ups inside an active hour. Fixed-term passes
                never auto-renew.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link href={pricingHref} className="btn btn-primary px-4 py-2 text-[13px]">
                  Local currency &amp; details
                </Link>
                <a
                  href={supportMailto("Credit question")}
                  className="btn px-4 py-2 text-[13px]"
                >
                  Contact
                </a>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
              <div className="rounded-xl border border-line bg-card p-6 shadow-[var(--card-shadow)]">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-mid">Free</p>
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
                  {dailyFreeHours} hrs/day · worldwide
                </p>
                <ul className="mt-5 space-y-2 border-t border-line pt-4 text-[13px] text-mid">
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>{TRIAL_CREDIT} Credit trial</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>DeepSeek V4.1 Flash &amp; GPT-OSS 120B</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Sandbox, previews &amp; GitHub PRs</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-accent/35 bg-card p-6 shadow-[var(--card-shadow)]">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-accent-text">
                    Passes
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
                  {paidDailyHours} hrs/day + wallet Credit
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

                <ul className="mt-4 space-y-2 border-t border-line pt-4 text-[13px] text-mid">
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Unlocks Claude Haiku 4.5</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 shrink-0 text-accent-text" strokeWidth={2} />
                    <span>Stackable · ends cleanly</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ────────────────────────────────────────────────────────── */}
        <section id="faq" className="lp-section border-t border-line bg-raised">
          <div className="lp-wrap">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <h2 className="text-balance text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
                How does Openmi work?
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-[13px] text-mid">
                <Link
                  href="/pricing"
                  className="font-medium text-accent-text underline-offset-2 hover:underline"
                >
                  Compare Openmi pass pricing
                </Link>
                <span aria-hidden="true" className="text-line-strong">
                  ·
                </span>
                <Link
                  href="/about"
                  className="font-medium text-accent-text underline-offset-2 hover:underline"
                >
                  Read the full execution contract
                </Link>
              </div>
            </div>

            <dl className="mt-8 grid gap-4 md:grid-cols-2">
              {HOME_FAQS.map((item) => (
                <div
                  key={item.question}
                  className="rounded-xl border border-line bg-card p-5 shadow-[var(--card-shadow)]"
                >
                  <dt className="text-[14.5px] font-semibold tracking-[-0.015em] text-hi">
                    {item.question}
                  </dt>
                  <dd className="mt-2 text-pretty text-[13px] leading-[1.6] text-mid">
                    {item.answer}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Closing CTA ────────────────────────────────────────────────── */}
        <section className="border-t border-line py-14 sm:py-16">
          <div className="lp-wrap flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <h2 className="text-balance text-[clamp(1.6rem,3vw,2.2rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-hi">
              Ship on GitHub for free.
            </h2>
            <Link
              href={loginHref}
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
              <p className="max-w-[26ch] text-[12.5px] leading-relaxed text-low">
                Browser GitHub coding agent, priced by the hour.
              </p>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-hi">Product</p>
              <ul className="mt-3 space-y-2 text-[13px] text-mid">
                <li>
                  <Link href={loginHref} className="hover:text-hi">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href={pricingHref} className="hover:text-hi">
                    Pricing &amp; passes
                  </Link>
                </li>
                <li>
                  <Link href="/about" className="hover:text-hi">
                    About
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-hi">Legal</p>
              <ul className="mt-3 space-y-2 text-[13px] text-mid">
                <li>
                  <Link href="/terms" className="hover:text-hi">
                    Terms
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="hover:text-hi">
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link href="/refunds" className="hover:text-hi">
                    Refunds
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <p className="text-[12px] font-semibold text-hi">Support</p>
              <ul className="mt-3 space-y-2 text-[13px] text-mid">
                <li>
                  <Link href="/report" className="hover:text-hi">
                    Report a problem
                  </Link>
                </li>
                <li>
                  <Link href="/suggestions" className="hover:text-hi">
                    Suggestions
                  </Link>
                </li>
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
            <div className="flex items-center gap-3">
              <p className="font-mono text-[11.5px] text-low">© 2026 Openmi</p>
              <VersionBadge />
            </div>
            <ThemeSwitcher />
          </div>
        </div>
      </footer>
    </div>
  );
}
