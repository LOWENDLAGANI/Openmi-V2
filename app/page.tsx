import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { WorkspaceFrame } from "@/components/LandingPreview";
import { PinnedWorkflow } from "@/components/PinnedWorkflow";
import { ArrowGlyph, SiteHeader } from "@/components/SiteHeader";
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
  description: `Browser GitHub coding agent with cloud Linux sandboxes, live previews, and isolated PRs. ${DAILY_FREE_CREDIT} free Credit daily, ${CREDIT_PER_HOUR} Credit per hour.`,
  other: { "page-type": "software", "site-kind": "software" },
});

const BOUNDARIES = [
  {
    title: "No force pushes",
    body: "Never rewrites Git history or overwrites a branch that moved ahead.",
  },
  {
    title: "Protected default branch",
    body: "Commits only to openmi/agent/<id> unless you explicitly name another branch.",
  },
  {
    title: "Real exit codes only",
    body: "Reports the exact exit code from the sandbox and never fabricates passing builds.",
  },
  {
    title: "No stored payment cards",
    body: "Fixed-term passes settle on hosted checkout and log every grant in an append-only ledger.",
  },
];

const HOME_FAQS = [
  {
    question: "How much does Openmi cost per hour?",
    answer: `Every named model costs ${CREDIT_PER_HOUR} Credit per hour with unlimited follow-up turns inside that active 60-minute window. Free accounts receive ${DAILY_FREE_CREDIT} free Credit every day (${Math.floor(DAILY_FREE_CREDIT / CREDIT_PER_HOUR)} hours/day) plus a ${TRIAL_CREDIT} Credit trial on the first turn.`,
  },
  {
    question: "Do paid passes auto-renew?",
    answer: `No. Fixed-term passes (${PLANS.map((p) => `${p.name} at RM ${p.price}`).join(" and ")}) raise your daily allowance to ${PAID_DAILY_FREE_CREDIT} Credit/day, add upfront wallet Credit, include Claude Haiku 4.5, and end cleanly without recurring charges.`,
  },
  {
    question: "Does Openmi write directly to my default branch?",
    answer:
      "No. Openmi reads files at the pinned commit SHA, writes unified diffs to an isolated openmi/agent/<id> branch, opens one pull request, and never force-pushes.",
  },
  {
    question: "What happens if a model provider fails to answer?",
    answer:
      "If the model provider returns no answer before the first token arrives, Openmi automatically releases the hour charge back to your Credit balance.",
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
    <div className="lp min-h-dvh bg-canvas">
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

      <SiteHeader loginHref={loginHref} />

      <main id="main">
        {/* ── Hero (dealt: centred over workspace window on sage lit ground) ── */}
        <section data-enter className="pt-28 pb-16 sm:pt-36 sm:pb-24">
          <div className="lp-wrap">
            {ref && (
              <div
                role="status"
                className="mx-auto mb-8 flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] border border-accent/30 bg-accent-soft px-4 py-2.5 text-[14px] text-accent-text"
              >
                <p>
                  Invite{" "}
                  <code className="rounded-[var(--r-sm)] bg-card px-1.5 py-0.5 font-mono text-[13px] text-hi">
                    {ref}
                  </code>{" "}
                  active: +{INVITE_REWARD_CREDIT} Credit for both accounts on first paid pass.
                </p>
                <Link
                  href={loginHref}
                  className="btn btn-primary h-9 px-3.5 text-[13px]"
                >
                  Apply code
                </Link>
              </div>
            )}

            <div className="mx-auto max-w-[760px] text-center">
              <h1 className="hero-enter-title mx-auto max-w-[18ch] text-balance text-[clamp(2.5rem,5.4vw,4.35rem)] font-medium leading-[1.03] tracking-[-0.036em] text-hi">
                GitHub coding agent, billed by the hour.
              </h1>
              <p className="hero-enter-body mx-auto mt-5 max-w-[50ch] text-pretty text-[17px] leading-[1.6] text-mid sm:text-[18.5px]">
                Edit repositories in a cloud Linux sandbox, check live previews, and ship isolated pull requests. {DAILY_FREE_CREDIT} free Credit daily, {CREDIT_PER_HOUR} Credit per active hour.
              </p>

              <div className="hero-enter-body mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={loginHref}
                  className="btn btn-primary h-11 px-5 text-[15px]"
                >
                  Start free with GitHub
                  <ArrowGlyph />
                </Link>
                <Link
                  href={pricingHref}
                  className="btn h-11 px-5 text-[15px]"
                >
                  See pricing
                </Link>
              </div>
            </div>

            <div className="hero-enter-media hero-stage ground-sage mt-12">
              <WorkspaceFrame />
            </div>
          </div>
        </section>

        {/* ── Features (2×2 open cards, real UI fragments, zero icon boxes) ── */}
        <section id="features" className="lp-section bg-mist-band">
          <div className="lp-wrap">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <h2 className="max-w-[26ch] text-balance text-[clamp(1.85rem,3.2vw,2.75rem)] font-medium leading-[1.08] tracking-[-0.03em] text-hi">
                Built for real repositories.{" "}
                <span className="text-mid">Every turn runs against a pinned commit.</span>
              </h2>
              <Link
                href={loginHref}
                className="t-link self-start text-[15px] font-medium"
              >
                Open workspace
                <ArrowGlyph />
              </Link>
            </div>

            <div className="mt-12 grid gap-8 md:grid-cols-2">
              <article className="flex flex-col justify-between">
                <div>
                  <h3 className="text-[20px] font-medium tracking-[-0.02em] text-hi">
                    Pin every edit to a commit SHA
                  </h3>
                  <p className="mt-2 max-w-[46ch] text-[16px] leading-[1.55] text-body">
                    Reads files at the exact branch HEAD, cites real path and line numbers, and writes unified diffs to an isolated branch.
                  </p>
                </div>
                <div className="mt-6 overflow-hidden rounded-[var(--r-lg)] border border-line bg-card p-4 font-mono text-[12px]">
                  <div className="flex items-center justify-between border-b border-line pb-2.5 text-low">
                    <span className="text-hi">lib/http/next-path.ts</span>
                    <span>9c17d08 → openmi/agent/3a90e4</span>
                  </div>
                  <div className="mt-2.5 space-y-1">
                    <p className="diff-row--del px-2 py-0.5 text-danger">
                      − if (!raw.startsWith(&quot;/&quot;)) return &quot;/chat&quot;;
                    </p>
                    <p className="diff-row--add px-2 py-0.5 text-[color:var(--diff-add)]">
                      + if (!raw.startsWith(&quot;/&quot;) || raw.startsWith(&quot;//&quot;)) return &quot;/chat&quot;;
                    </p>
                  </div>
                </div>
              </article>

              <article className="flex flex-col justify-between">
                <div>
                  <h3 className="text-[20px] font-medium tracking-[-0.02em] text-hi">
                    Run builds in a cloud Linux sandbox
                  </h3>
                  <p className="mt-2 max-w-[46ch] text-[16px] leading-[1.55] text-body">
                    Persistent per-chat shell with a 48-hour checkpoint TTL, live browser previews, and one-click Vercel publish.
                  </p>
                </div>
                <div className="mt-6 overflow-hidden rounded-[var(--r-lg)] border border-line bg-card p-4 font-mono text-[12px]">
                  <div className="flex items-center justify-between border-b border-line pb-2.5 text-low">
                    <span className="text-hi">sandbox · /workspace</span>
                    <span>48h TTL</span>
                  </div>
                  <div className="mt-2.5 space-y-1 text-mid">
                    <p className="text-hi">$ pnpm run build</p>
                    <p>Route (app) compiled in 4.2s</p>
                    <p className="text-[color:var(--diff-add)]">exit 0 · preview ready</p>
                  </div>
                </div>
              </article>

              <article className="flex flex-col justify-between">
                <div>
                  <h3 className="text-[20px] font-medium tracking-[-0.02em] text-hi">
                    Pay by the hour, never by the token
                  </h3>
                  <p className="mt-2 max-w-[46ch] text-[16px] leading-[1.55] text-body">
                    One active hour costs {CREDIT_PER_HOUR} Credit with unlimited follow-up turns. Provider failures before the first token refund automatically.
                  </p>
                </div>
                <div className="mt-6 overflow-hidden rounded-[var(--r-lg)] border border-line bg-card p-4 font-mono text-[12px]">
                  <div className="flex items-center justify-between border-b border-line pb-2.5 text-low">
                    <span className="text-hi">credit_transactions</span>
                    <span>append-only</span>
                  </div>
                  <div className="mt-2.5 divide-y divide-line">
                    <div className="flex justify-between py-1.5">
                      <span className="text-mid">Daily free grant</span>
                      <span className="tabular-nums text-[color:var(--diff-add)]">+{DAILY_FREE_CREDIT}.00</span>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-mid">Hour session (60 min)</span>
                      <span className="tabular-nums text-hi">−{CREDIT_PER_HOUR}.00</span>
                    </div>
                  </div>
                </div>
              </article>

              <article className="flex flex-col justify-between">
                <div>
                  <h3 className="text-[20px] font-medium tracking-[-0.02em] text-hi">
                    Switch coding models per thread
                  </h3>
                  <p className="mt-2 max-w-[46ch] text-[16px] leading-[1.55] text-body">
                    Use DeepSeek V4.1 Flash and GPT-OSS 120B on the free tier, or add Claude Haiku 4.5 with a fixed-term pass.
                  </p>
                </div>
                <div className="mt-6 overflow-hidden rounded-[var(--r-lg)] border border-line bg-card p-4 font-mono text-[12px]">
                  <div className="flex items-center justify-between border-b border-line pb-2.5 text-low">
                    <span className="text-hi">Model catalogue</span>
                    <span>rate</span>
                  </div>
                  <div className="mt-2.5 divide-y divide-line">
                    <div className="flex justify-between py-1.5">
                      <span className="text-hi">DeepSeek V4.1 Flash</span>
                      <span className="tabular-nums text-mid">{CREDIT_PER_HOUR} Credit/hr · Free</span>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-hi">Claude Haiku 4.5</span>
                      <span className="tabular-nums text-accent-text">{CREDIT_PER_HOUR} Credit/hr · Pass</span>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ── Workflow (dealt moment: pinned-chapters) ──────────────────── */}
        <section id="how" className="lp-section bg-canvas">
          <div className="lp-wrap">
            <h2 className="max-w-[24ch] text-balance text-[clamp(1.85rem,3.2vw,2.75rem)] font-medium leading-[1.08] tracking-[-0.03em] text-hi">
              How a turn runs.{" "}
              <span className="text-mid">Three steps from branch HEAD to pull request.</span>
            </h2>
            <PinnedWorkflow />
          </div>
        </section>

        {/* ── Hard Boundaries (dealt rhythm: dark-band) ─────────────────── */}
        <section id="limits" className="lp-section ground-inverse">
          <div className="lp-wrap">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <h2 className="max-w-[24ch] text-balance text-[clamp(1.85rem,3.2vw,2.75rem)] font-medium leading-[1.08] tracking-[-0.03em] text-[var(--inv-ink)]">
                Hard execution boundaries.{" "}
                <span className="text-[var(--inv-muted)]">What Openmi refuses to do.</span>
              </h2>
              <Link
                href="/about"
                className="t-link self-start text-[15px] font-medium text-[var(--inv-ink)]"
              >
                Read the full contract
                <ArrowGlyph />
              </Link>
            </div>

            <dl className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {BOUNDARIES.map((item) => (
                <div
                  key={item.title}
                  className="border-t border-[var(--inv-line)] pt-5"
                >
                  <dt className="text-[18px] font-medium tracking-[-0.02em] text-[var(--inv-ink)]">
                    {item.title}
                  </dt>
                  <dd className="mt-2.5 text-[15.5px] leading-[1.6] text-[var(--inv-muted)]">
                    {item.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Pricing & Open FAQ ────────────────────────────────────────── */}
        <section id="pricing" className="lp-section bg-canvas">
          <div className="lp-wrap">
            <div className="grid items-start gap-12 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <h2 className="text-balance text-[clamp(1.85rem,3.2vw,2.75rem)] font-medium leading-[1.08] tracking-[-0.03em] text-hi">
                  {CREDIT_PER_HOUR} Credit per hour.{" "}
                  <span className="text-mid">Zero subscriptions.</span>
                </h2>
                <p className="mt-4 max-w-[42ch] text-[16px] leading-[1.6] text-body">
                  Unlimited follow-ups inside every active hour. Fixed-term passes extend cleanly and never auto-renew.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link href={pricingHref} className="btn btn-primary h-11 px-5 text-[15px]">
                    Compare local currencies
                    <ArrowGlyph />
                  </Link>
                  <a
                    href={supportMailto("Credit question")}
                    className="btn h-11 px-5 text-[15px]"
                  >
                    Email support
                  </a>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2 lg:col-span-7">
                <div className="rounded-[var(--r-lg)] border border-line bg-card p-6">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[16px] font-medium text-hi">Free tier</h3>
                    <span className="font-mono text-[12px] text-low">Ad-supported</span>
                  </div>
                  <p className="mt-4 font-mono text-[32px] font-medium leading-none tracking-[-0.03em] tabular-nums text-hi">
                    {DAILY_FREE_CREDIT}{" "}
                    <span className="font-sans text-[14px] font-normal text-mid">
                      Credit / day
                    </span>
                  </p>
                  <p className="mt-2 text-[14px] text-mid">
                    {dailyFreeHours} hours/day worldwide
                  </p>
                  <ul className="mt-6 space-y-2.5 border-t border-line pt-5 text-[15px] text-body">
                    <li>{TRIAL_CREDIT} Credit trial on your first turn</li>
                    <li>DeepSeek V4.1 Flash &amp; GPT-OSS 120B</li>
                    <li>Cloud sandbox, live previews &amp; GitHub PRs</li>
                  </ul>
                </div>

                <div className="rounded-[var(--r-lg)] border border-accent bg-card p-6">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[16px] font-medium text-accent-text">
                      Fixed-term passes
                    </h3>
                    <span className="font-mono text-[12px] text-accent-text">
                      No auto-renew
                    </span>
                  </div>
                  <p className="mt-4 font-mono text-[32px] font-medium leading-none tracking-[-0.03em] tabular-nums text-hi">
                    {PAID_DAILY_FREE_CREDIT}{" "}
                    <span className="font-sans text-[14px] font-normal text-mid">
                      Credit / day
                    </span>
                  </p>
                  <p className="mt-2 text-[14px] text-mid">
                    {paidDailyHours} hours/day + upfront wallet Credit
                  </p>

                  <div className="mt-5 grid grid-cols-2 gap-2.5">
                    {PLANS.map((plan) => (
                      <div
                        key={plan.id}
                        className="rounded-[var(--r-md)] border border-line bg-raised px-3 py-2.5"
                      >
                        <p className="text-[13px] font-medium text-mid">{plan.name}</p>
                        <p className="mt-1 font-mono text-[16px] font-medium tabular-nums text-hi">
                          RM {plan.price}
                        </p>
                        <p className="mt-0.5 font-mono text-[12px] tabular-nums text-accent-text">
                          +{plan.credit} Credit
                        </p>
                      </div>
                    ))}
                  </div>

                  <ul className="mt-5 space-y-2.5 border-t border-line pt-5 text-[15px] text-body">
                    <li>Includes Claude Haiku 4.5</li>
                    <li>Stackable passes, ends cleanly</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Open ruled FAQ (no boxed accordion) */}
            <div id="faq" className="mt-20 border-t border-line pt-14">
              <h2 className="text-[clamp(1.5rem,2.4vw,2rem)] font-medium tracking-[-0.028em] text-hi">
                Common questions
              </h2>
              <dl className="mt-8 grid gap-x-12 gap-y-8 md:grid-cols-2">
                {HOME_FAQS.map((item) => (
                  <div key={item.question} className="border-t border-line pt-5">
                    <dt className="text-[17px] font-medium tracking-[-0.015em] text-hi">
                      {item.question}
                    </dt>
                    <dd className="mt-2 text-[15.5px] leading-[1.6] text-mid">
                      {item.answer}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>
      </main>

      {/* ── Combined Closing CTA + Footer (dealt: footer-dark + close-word) ── */}
      <footer className="ground-inverse pt-20 pb-12" aria-labelledby="close-h">
        <div className="lp-wrap">
          <div className="flex flex-col items-start justify-between gap-6 border-b border-[var(--inv-line)] pb-14 sm:flex-row sm:items-end">
            <div>
              <h2
                id="close-h"
                className="max-w-[20ch] text-balance text-[clamp(2rem,3.6vw,3rem)] font-medium leading-[1.06] tracking-[-0.032em] text-[var(--inv-ink)]"
              >
                Ship on GitHub from the browser.
              </h2>
              <p className="mt-3 text-[16px] text-[var(--inv-muted)]">
                {DAILY_FREE_CREDIT} free Credit every day. No card and no API keys required.
              </p>
            </div>
            <Link
              href={loginHref}
              className="btn btn-primary h-12 shrink-0 px-6 text-[15px]"
            >
              Start free with GitHub
              <ArrowGlyph />
            </Link>
          </div>

          <p
            aria-hidden="true"
            className="select-none py-8 text-[clamp(3.75rem,12vw,9.5rem)] font-medium leading-[0.9] tracking-[-0.045em] text-[var(--inv-ink)]"
          >
            Openmi
          </p>

          <div className="grid gap-8 border-t border-[var(--inv-line)] pt-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-3">
              <Brand compact />
              <p className="max-w-[26ch] text-[14px] leading-relaxed text-[var(--inv-muted)]">
                Browser GitHub coding agent, billed by the hour.
              </p>
            </div>

            <div>
              <h3 className="text-[13px] font-medium text-[var(--inv-ink)]">Product</h3>
              <ul className="mt-3 space-y-2.5 text-[14px] text-[var(--inv-muted)]">
                <li>
                  <Link href={loginHref} className="hover:text-[var(--inv-ink)]">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href={pricingHref} className="hover:text-[var(--inv-ink)]">
                    Pricing &amp; passes
                  </Link>
                </li>
                <li>
                  <Link href="/about" className="hover:text-[var(--inv-ink)]">
                    About
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-[13px] font-medium text-[var(--inv-ink)]">Legal</h3>
              <ul className="mt-3 space-y-2.5 text-[14px] text-[var(--inv-muted)]">
                <li>
                  <Link href="/terms" className="hover:text-[var(--inv-ink)]">
                    Terms
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="hover:text-[var(--inv-ink)]">
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link href="/refunds" className="hover:text-[var(--inv-ink)]">
                    Refunds
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-[13px] font-medium text-[var(--inv-ink)]">Support</h3>
              <ul className="mt-3 space-y-2.5 text-[14px] text-[var(--inv-muted)]">
                <li>
                  <Link href="/report" className="hover:text-[var(--inv-ink)]">
                    Report a problem
                  </Link>
                </li>
                <li>
                  <Link href="/suggestions" className="hover:text-[var(--inv-ink)]">
                    Suggestions
                  </Link>
                </li>
                <li>
                  <a
                    href={supportMailto("Support")}
                    className="hover:text-[var(--inv-ink)]"
                  >
                    Email support
                  </a>
                </li>
                <li>
                  <Link href="/account/delete" className="hover:text-[var(--inv-ink)]">
                    Delete account
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--inv-line)] pt-6">
            <div className="flex items-center gap-3">
              <p className="font-mono text-[13px] text-[var(--inv-muted)]">© 2026 Openmi</p>
              <VersionBadge />
            </div>
            <ThemeSwitcher />
          </div>
        </div>
      </footer>
    </div>
  );
}
