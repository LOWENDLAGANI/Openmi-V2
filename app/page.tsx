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

// The landing page reads the session to send a signed-in reader to /chat, so it
// must be evaluated per request even on a deployment with no Supabase keys.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Openmi — a repository agent for GitHub",
  description: `Reads your code at a pinned commit, cites the file and line it used, and proposes the change as a diff you approve. ${CREDIT_PER_HOUR} Credit an hour, ${DAILY_FREE_CREDIT} free every day.`,
  other: { "page-type": "software", "site-kind": "software" },
};

/**
 * The front door, planned as screens rather than as sections.
 *
 * One idea per screen: the claim and the product (hero), the mechanism (how a
 * turn runs), what it refuses (limits), the price, and the way in. Every block
 * starts on the same left line and ends on the same right one, so the page
 * reads as one column of decisions instead of a pile of components.
 *
 * Every number here is imported from `lib/credits`, never typed: a price change
 * is one edit, and a stale figure on the front page cannot happen.
 */

const NAV = [
  { href: "#how", label: "How a turn runs" },
  { href: "#limits", label: "Limits" },
  { href: "#pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

const STEPS = [
  {
    title: "Pick a repository",
    body: "Sign in, connect GitHub with OAuth or a fine-grained token, and choose a branch. The turn is pinned to the commit it started on.",
  },
  {
    title: "Give it a goal",
    body: "The model lists files, reads them and searches the tree through a GET-only client, and answers with a path and a line for every claim.",
  },
  {
    title: "Review the diff",
    body: "Each file arrives as a unified diff with three lines of context. Accept a file or reject it, then approve the set that is left.",
  },
];

const LIMITS = [
  {
    title: "Run your test suite",
    body: "A verification run records an install or a build and the exit code it saw. The card never claims a test that did not run.",
  },
  {
    title: "Write your default branch",
    body: "A change goes to openmi/agent/<id> unless you name the destination yourself. Approval opens one pull request.",
  },
  {
    title: "Force a branch",
    body: "A branch that moved under the diff is re-applied on the live head, or the change goes to a new branch. Never pushed over.",
  },
  {
    title: "Take your card",
    body: "Payment happens on the hosted page, not in this app. Credit arrives by the daily allowance or a redeem code.",
  },
];

export default async function HomePage() {
  // A signed-in reader does not need the pitch; the workspace is where they
  // were going, and the landing page is the front door for everyone else.
  const session = await getSession();
  if (session.state === "signed-in") redirect("/chat");

  return (
    <div className="lp min-h-dvh">
      <a
        href="#main"
        className="sr-only rounded-full focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-card focus:px-4 focus:py-2 focus:text-[13px] focus:text-hi"
      >
        Skip to content
      </a>

      <header className="glass hairline-b fixed inset-x-0 top-0 z-50">
        <div className="lp-wrap flex h-16 items-center justify-between gap-3">
          <Link href="/" aria-label="Openmi home" className="shrink-0">
            <Brand compact />
          </Link>

          <nav aria-label="Sections" className="hidden items-center gap-7 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[13px] text-mid transition-colors hover:text-hi"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <ThemeSwitcher variant="icon" />
            <Link
              href="/login"
              className="btn btn-primary lift px-4 py-2 text-[12.5px]"
            >
              Start with GitHub
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ── The claim, and the product ─────────────────────────────────── */}
        <section className="flex min-h-svh flex-col justify-center pb-12 pt-28 sm:pt-32">
          <div className="lp-wrap">
            <h1 className="max-w-[22ch] text-balance text-[clamp(2.45rem,5.2vw,4.15rem)] font-medium leading-[1.02] tracking-[-0.035em] text-hi">
              A repository agent for GitHub
            </h1>

            <p className="mt-5 max-w-[54ch] text-pretty text-[15.5px] leading-[1.62] text-mid">
              It reads your code at a pinned commit, cites the file and line it
              used, and writes the change to its own branch as a diff you
              approve. Nothing reaches the default branch on its own.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3">
              <Link
                href="/login"
                className="btn btn-primary lift px-5 py-2.5 text-[13.5px]"
              >
                Start with GitHub
                <span aria-hidden="true">→</span>
              </Link>
              {/* One primary action above the fold. The second path is a link,
                  not a second button: two equal-weight buttons is the pattern
                  that makes a hero look undecided. */}
              <a
                href="#how"
                className="text-[13px] text-mid underline decoration-line-strong underline-offset-4 transition-colors hover:text-hi hover:decoration-current"
              >
                See a turn run ↓
              </a>
              <span className="text-[12px] text-low">
                No card. Sign in with GitHub.
              </span>
            </div>

            <dl className="mt-8 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-line pt-4 text-[12.5px]">
              <div className="flex items-baseline gap-2">
                <dt className="text-low">An hour</dt>
                <dd className="font-medium tabular-nums text-hi">
                  {CREDIT_PER_HOUR} Credit
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-low">Free every day</dt>
                <dd className="font-medium tabular-nums text-hi">
                  {DAILY_FREE_CREDIT} Credit
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-low">Auto</dt>
                <dd className="font-medium text-hi">No charge</dd>
              </div>
            </dl>

            <div className="mt-9 animate-enter sm:mt-11">
              <WorkspaceFrame />
            </div>
          </div>
        </section>

        {/* ── The mechanism ─────────────────────────────────────────────── */}
        <section id="how" className="lp-section">
          <div className="lp-wrap grid gap-10 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-6">
              <h2 className="max-w-[18ch] text-balance text-[clamp(1.75rem,3.2vw,2.5rem)] font-medium leading-[1.08] tracking-[-0.03em] text-hi">
                How a turn runs
              </h2>
              <p className="mt-4 max-w-[46ch] text-[14.5px] leading-[1.65] text-mid">
                Four read-only tools and one that proposes text. The model never
                holds your token: every GitHub request is built on the server
                from the token and a path in the pinned tree.
              </p>

              <ol className="mt-8 border-y border-line">
                {STEPS.map((step, index) => (
                  <li
                    key={step.title}
                    className="flex gap-5 border-t border-line py-4 first:border-t-0"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 w-5 shrink-0 font-mono text-[11px] tabular-nums text-accent-text"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[14.5px] font-medium tracking-[-0.015em] text-hi">
                        {step.title}
                      </h3>
                      <p className="mt-1 text-pretty text-[13px] leading-[1.6] text-mid">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="md:col-span-6 md:pt-1">
              <RunTrace />
              <p className="mt-3 text-[11.5px] leading-[1.6] text-low">
                Caps are enforced by compare-and-set in Postgres, so a replayed
                continuation matches no row.
              </p>
            </div>
          </div>
        </section>

        {/* ── The refusals ──────────────────────────────────────────────── */}
        <section id="limits" className="lp-section bg-raised">
          <div className="lp-wrap">
            <h2 className="max-w-[24ch] text-balance text-[clamp(1.75rem,3.2vw,2.5rem)] font-medium leading-[1.08] tracking-[-0.03em] text-hi">
              What it will not do
            </h2>
            <p className="mt-4 max-w-[52ch] text-pretty text-[14.5px] leading-[1.65] text-mid">
              The card states what was observed. Where it did nothing, it says
              that too, which is the part worth reading before you connect a
              repository.
            </p>

            <dl className="mt-10 grid gap-x-12 sm:grid-cols-2">
              {LIMITS.map((item) => (
                <div
                  key={item.title}
                  className="border-t border-line py-5"
                >
                  <dt className="text-[14px] font-medium tracking-[-0.015em] text-hi">
                    {item.title}
                  </dt>
                  <dd className="mt-1.5 text-pretty text-[13px] leading-[1.6] text-mid">
                    {item.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── The price ─────────────────────────────────────────────────── */}
        <section id="pricing" className="lp-section">
          <div className="lp-wrap grid gap-10 md:grid-cols-12 md:gap-12">
            <div className="md:col-span-6">
              <h2 className="max-w-[16ch] text-balance text-[clamp(1.75rem,3.2vw,2.5rem)] font-medium leading-[1.08] tracking-[-0.03em] text-hi">
                {CREDIT_PER_HOUR} Credit an hour
              </h2>
              <p className="mt-4 max-w-[44ch] text-[14.5px] leading-[1.65] text-mid">
                An hour belongs to the model and the chat that started it. More
                turns inside that hour cost nothing, on any model you picked.
              </p>
              <p className="mt-4 max-w-[44ch] text-[13px] leading-[1.6] text-low">
                Nothing renews. A pass ends on its own and the daily allowance
                goes back to {DAILY_FREE_CREDIT} Credit.
              </p>
            </div>

            <div className="md:col-span-6">
              <dl className="border-t border-line">
                {[
                  {
                    label: "Free every day",
                    value: `${DAILY_FREE_CREDIT} Credit`,
                    note: `${PAID_DAILY_FREE_CREDIT} with a pass`,
                  },
                  {
                    label: "An hour of chat",
                    value: `${CREDIT_PER_HOUR} Credit`,
                    note: "Auto is free",
                  },
                  {
                    label: "Trial credit",
                    value: `${TRIAL_CREDIT} Credit`,
                    note: "once per account",
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-baseline justify-between gap-4 border-b border-line py-4"
                  >
                    <dt className="text-[13.5px] text-body">{row.label}</dt>
                    <dd className="text-right">
                      <span className="block text-[14px] font-medium tabular-nums text-hi">
                        {row.value}
                      </span>
                      <span className="block text-[11.5px] text-low">
                        {row.note}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link href="/pay" className="btn lift px-4 py-2 text-[13px]">
                  See plans
                </Link>
                <a
                  href={supportMailto("Credit question")}
                  className="text-[13px] text-mid underline decoration-line-strong underline-offset-4 transition-colors hover:text-hi hover:decoration-current"
                >
                  Ask about Credit
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ── The way in, and the facts about this page ──────────────────── */}
        <footer className="lp-section border-t border-line">
          <div className="lp-wrap">
            <div className="grid items-end gap-8 md:grid-cols-12 md:gap-12">
              <div className="md:col-span-7">
                <h2 className="max-w-[20ch] text-balance text-[clamp(1.9rem,3.6vw,2.8rem)] font-medium leading-[1.06] tracking-[-0.032em] text-hi">
                  Start from your repository
                </h2>
                <p className="mt-4 max-w-[44ch] text-pretty text-[14.5px] leading-[1.65] text-mid">
                  Sign in with GitHub and send the first message. The free daily
                  allowance covers it.
                </p>
              </div>

              <div className="md:col-span-5 md:justify-self-end">
                <Link
                  href="/login"
                  className="btn btn-primary lift w-full px-6 py-3 text-[14px] sm:w-auto"
                >
                  Start with GitHub
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>

            <div className="mt-16 flex flex-col gap-5 border-t border-line pt-6 sm:mt-20 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]">
                <Link href="/pay" className="text-mid transition-colors hover:text-hi">
                  Pricing
                </Link>
                <Link href="/about" className="text-mid transition-colors hover:text-hi">
                  About
                </Link>
                <Link href="/terms" className="text-mid transition-colors hover:text-hi">
                  Terms
                </Link>
                <Link href="/privacy" className="text-mid transition-colors hover:text-hi">
                  Privacy
                </Link>
                <Link href="/refunds" className="text-mid transition-colors hover:text-hi">
                  Refunds
                </Link>
                <a
                  href={supportMailto("Support")}
                  className="text-mid transition-colors hover:text-hi"
                >
                  Support
                </a>
              </div>

              <p className="font-mono text-[11px] text-low">
                © 2026 Openmi
              </p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
