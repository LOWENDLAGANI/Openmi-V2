import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { WorkspaceFrame } from "@/components/LandingPreview";
import { PinnedWorkflow } from "@/components/PinnedWorkflow";
import { ScrollFillText } from "@/components/ScrollFillText";
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

const MANIFESTO = [
  "Every repository read.",
  "Every branch opened.",
  "Every diff reviewed.",
  "Every pull request merged.",
  "That’s execution.",
  "Chat creates the intention.",
  "A sandbox creates the proof.",
  "A pull request creates the value.",
  "The more we ask of coding agents, the more they have to actually run.",
  "And verified execution is becoming the bottleneck.",
  "Openmi was built for this.",
];

const STATS = [
  {
    value: `${CREDIT_PER_HOUR}`,
    unit: "Credit / hour",
    body: "One active hour, unlimited follow-up turns inside it.",
  },
  {
    value: `${DAILY_FREE_CREDIT}`,
    unit: "Credit / day",
    body: "Free allowance that tops up every day, with no card on file.",
  },
  {
    value: "48h",
    unit: "workspace TTL",
    body: "A persistent Linux sandbox per chat, stopped long before it is deleted.",
  },
  {
    value: "1",
    unit: "pull request",
    body: "One isolated branch, one commit, one reviewable PR. Never a force push.",
  },
];

const FEATURES = [
  {
    index: "01",
    title: "Pin every edit to a commit SHA",
    body: "Openmi reads files at the exact branch HEAD, cites real path and line numbers, and writes unified diffs to an isolated branch.",
    frame: (
      <div className="mt-6 overflow-hidden rounded-[var(--r-md)] border border-line bg-card p-4 font-mono text-[12px]">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-2.5 text-low">
          <span className="text-hi">lib/http/next-path.ts</span>
          <span className="shrink-0">9c17d08 → openmi/agent/3a90e4</span>
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
    ),
  },
  {
    index: "02",
    title: "Run builds in a cloud Linux sandbox",
    body: "A persistent per-chat shell with installs, typechecks, tests and live previews. Every result is reported with the exit code it actually produced.",
    frame: (
      <div className="mt-6 overflow-hidden rounded-[var(--r-md)] border border-line bg-card p-4 font-mono text-[12px]">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-2.5 text-low">
          <span className="text-hi">sandbox · /workspace</span>
          <span className="shrink-0">48h TTL</span>
        </div>
        <div className="mt-2.5 space-y-1 text-mid">
          <p className="text-hi">$ pnpm run build</p>
          <p>Route (app) compiled in 4.2s</p>
          <p className="text-[color:var(--diff-add)]">exit 0 · preview ready</p>
        </div>
      </div>
    ),
  },
  {
    index: "03",
    title: "Pay by the hour, never by the token",
    body: `One active hour costs ${CREDIT_PER_HOUR} Credit with unlimited follow-up turns. A provider failure before the first token refunds the hour automatically.`,
    frame: (
      <div className="mt-6 overflow-hidden rounded-[var(--r-md)] border border-line bg-card p-4 font-mono text-[12px]">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-2.5 text-low">
          <span className="text-hi">credit_transactions</span>
          <span className="shrink-0">append-only</span>
        </div>
        <div className="mt-2.5 divide-y divide-line">
          <div className="flex justify-between py-1.5">
            <span className="text-mid">Daily free grant</span>
            <span className="tabular-nums text-[color:var(--diff-add)]">
              +{DAILY_FREE_CREDIT}.00
            </span>
          </div>
          <div className="flex justify-between py-1.5">
            <span className="text-mid">Hour session (60 min)</span>
            <span className="tabular-nums text-hi">−{CREDIT_PER_HOUR}.00</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    index: "04",
    title: "Switch coding models per thread",
    body: "Use DeepSeek V4.1 Flash and GPT-OSS 120B on the free tier, or add Claude Haiku 4.5 with a fixed-term pass.",
    frame: (
      <div className="mt-6 overflow-hidden rounded-[var(--r-md)] border border-line bg-card p-4 font-mono text-[12px]">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-2.5 text-low">
          <span className="text-hi">Model catalogue</span>
          <span className="shrink-0">rate</span>
        </div>
        <div className="mt-2.5 divide-y divide-line">
          <div className="flex justify-between py-1.5">
            <span className="text-hi">DeepSeek V4.1 Flash</span>
            <span className="tabular-nums text-mid">
              {CREDIT_PER_HOUR} Credit/hr · Free
            </span>
          </div>
          <div className="flex justify-between py-1.5">
            <span className="text-hi">Claude Haiku 4.5</span>
            <span className="tabular-nums text-accent-text">
              {CREDIT_PER_HOUR} Credit/hr · Pass
            </span>
          </div>
        </div>
      </div>
    ),
  },
];

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
        {/* ── Manifesto (scroll fills the type in, word by word) ─────────── */}
        <section className="pt-32 pb-16 sm:pt-40 sm:pb-24">
          <div className="lp-wrap">
            {ref && (
              <div
                role="status"
                className="mb-10 flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] border border-accent/30 bg-accent-soft px-4 py-2.5 text-[14px] text-accent-text"
              >
                <p>
                  Invite{" "}
                  <code className="rounded-[var(--r-sm)] bg-card px-1.5 py-0.5 font-mono text-[13px] text-hi">
                    {ref}
                  </code>{" "}
                  active: +{INVITE_REWARD_CREDIT} Credit for both accounts on
                  first paid pass.
                </p>
                <Link
                  href={loginHref}
                  className="btn btn-primary h-9 px-3.5 text-[13px]"
                >
                  Apply code
                </Link>
              </div>
            )}

            <ScrollFillText
              stanzas={MANIFESTO}
              className="manifesto"
            />

            <div className="mt-14 flex flex-wrap items-center gap-3">
              <Link
                href={loginHref}
                className="btn btn-primary h-12 rounded-[4px] px-6 text-[15px]"
              >
                Start free with GitHub
                <ArrowGlyph />
              </Link>
              <Link href={pricingHref} className="btn h-12 px-6 text-[15px]">
                See pricing
              </Link>
            </div>

            <p className="mt-4 font-mono text-[12.5px] text-low">
              {DAILY_FREE_CREDIT} free Credit every day · no card, no API keys
            </p>
          </div>
        </section>

        {/* ── The claim ─────────────────────────────────────────────────── */}
        <section className="lp-section bg-canvas">
          <div className="lp-wrap">
            <h2 className="display-xl mx-auto max-w-[19ch] text-center">
              What if your agent{" "}
              <span className="accent-word">ran the code?</span>
            </h2>
            <p className="mx-auto mt-6 max-w-[56ch] text-center text-[17.5px] leading-[1.55] text-mid sm:text-[19px]">
              Openmi pins your repository to a commit, edits it inside a cloud
              Linux sandbox, checks the build it wrote, and ships one isolated
              pull request. {DAILY_FREE_CREDIT} free Credit daily,{" "}
              {CREDIT_PER_HOUR} Credit per active hour.
            </p>

            <div className="product-stage mt-14">
              <WorkspaceFrame />
            </div>
          </div>
        </section>

        {/* ── Facts on a hairline row ───────────────────────────────────── */}
        <section className="bg-mist-band">
          <div className="lp-wrap py-14 sm:py-16">
            <dl className="grid gap-10 border-y border-line py-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
              {STATS.map((stat) => (
                <div key={stat.unit}>
                  <dd className="stat-value">
                    {stat.value}
                    <span className="ml-1.5 font-sans text-[14px] font-normal tracking-normal text-mid">
                      {stat.unit}
                    </span>
                  </dd>
                  <dt className="mt-3 max-w-[30ch] text-[14.5px] leading-[1.55] text-mid">
                    {stat.body}
                  </dt>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────────────────── */}
        <section id="features" className="lp-section bg-canvas">
          <div className="lp-wrap">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <h2 className="display-lg max-w-[26ch]">
                Built for real repositories.
              </h2>
              <p className="max-w-[38ch] text-[16px] leading-[1.55] text-mid md:text-right">
                Every turn reads a pinned commit, writes a reviewable diff, and
                runs inside the chat&rsquo;s own workspace.
              </p>
            </div>

            <div className="mt-14 grid gap-x-16 gap-y-14 md:grid-cols-2">
              {FEATURES.map((feature) => (
                <article key={feature.index} className="border-t border-line pt-6">
                  <div className="flex items-baseline gap-3">
                    <span className="feature-index">{feature.index}</span>
                    <h3 className="display-md">{feature.title}</h3>
                  </div>
                  <p className="mt-3 max-w-[46ch] text-[16px] leading-[1.6] text-body">
                    {feature.body}
                  </p>
                  {feature.frame}
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Workflow ──────────────────────────────────────────────────── */}
        <section id="how" className="lp-section bg-mist-band">
          <div className="lp-wrap">
            <h2 className="display-lg max-w-[24ch]">
              How a turn runs.{" "}
              <span className="text-mid">
                Three steps from branch HEAD to pull request.
              </span>
            </h2>
            <PinnedWorkflow />
          </div>
        </section>

        {/* ── Hard boundaries ──────────────────────────────────────────── */}
        <section id="limits" className="lp-section ground-inverse">
          <div className="lp-wrap">
            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <h2 className="display-lg max-w-[24ch] text-[var(--inv-ink)]">
                Hard execution boundaries.{" "}
                <span className="text-[var(--inv-muted)]">
                  What Openmi refuses to do.
                </span>
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
                <div key={item.title} className="border-t border-[var(--inv-line)] pt-5">
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

        {/* ── Pricing & FAQ ─────────────────────────────────────────────── */}
        <section id="pricing" className="lp-section bg-canvas">
          <div className="lp-wrap">
            <div className="grid items-start gap-12 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <h2 className="display-lg">
                  {CREDIT_PER_HOUR} Credit per hour.{" "}
                  <span className="text-mid">Zero subscriptions.</span>
                </h2>
                <p className="mt-4 max-w-[42ch] text-[16px] leading-[1.6] text-body">
                  Unlimited follow-ups inside every active hour. Fixed-term
                  passes extend cleanly and never auto-renew.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link
                    href={pricingHref}
                    className="btn btn-primary h-11 px-5 text-[15px]"
                  >
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
                <div className="rounded-[var(--r-md)] border border-line bg-card p-6">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[16px] font-medium text-hi">Free tier</h3>
                    <span className="font-mono text-[12px] text-low">
                      Ad-supported
                    </span>
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

                <div className="rounded-[var(--r-md)] border border-accent bg-card p-6">
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
                        className="rounded-[var(--r-sm)] border border-line bg-raised px-3 py-2.5"
                      >
                        <p className="text-[13px] font-medium text-mid">
                          {plan.name}
                        </p>
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

            <div id="faq" className="mt-20 border-t border-line pt-14">
              <h2 className="display-md">Common questions</h2>
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

      {/* ── Closing CTA + footer, on the bone ground ───────────────────── */}
      <footer className="border-t border-line pt-20 pb-12" aria-labelledby="close-h">
        <div className="lp-wrap">
          <div className="flex flex-col items-start justify-between gap-6 border-b border-line pb-14 sm:flex-row sm:items-end">
            <div>
              <h2 id="close-h" className="display-lg max-w-[20ch]">
                Ship on GitHub from the browser.
              </h2>
              <p className="mt-3 text-[16px] text-mid">
                {DAILY_FREE_CREDIT} free Credit every day. No card and no API
                keys required.
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

          <p aria-hidden="true" className="wordmark select-none py-8">
            Openmi
          </p>

          <div className="grid gap-8 border-t border-line pt-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-3">
              <Brand compact />
              <p className="max-w-[26ch] text-[14px] leading-relaxed text-mid">
                Browser GitHub coding agent, billed by the hour.
              </p>
            </div>

            <div>
              <h3 className="text-[13px] font-medium text-hi">Product</h3>
              <ul className="mt-3 space-y-2.5 text-[14px] text-mid">
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
              <h3 className="text-[13px] font-medium text-hi">Legal</h3>
              <ul className="mt-3 space-y-2.5 text-[14px] text-mid">
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
              <h3 className="text-[13px] font-medium text-hi">Support</h3>
              <ul className="mt-3 space-y-2.5 text-[14px] text-mid">
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
                  <a href={supportMailto("Support")} className="hover:text-hi">
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
              <p className="font-mono text-[13px] text-mid">© 2026 Openmi</p>
              <VersionBadge />
            </div>
            <ThemeSwitcher />
          </div>
        </div>
      </footer>
    </div>
  );
}
