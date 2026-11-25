import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
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

/**
 * The landing page is one continuous answer, not a stack of sections: each
 * question and its answer is part of the same scroll fill, so the whole page
 * darkens as it is read. Copy states the real product behaviour, in the words
 * a person would actually use to ask.
 */
const HOME_FAQS = [
  {
    question: "What is Openmi?",
    answer:
      "A coding agent that works in your GitHub repository from the browser. You describe the change, it reads the code at a pinned commit, edits it in a cloud Linux sandbox, runs the checks, and opens one pull request you can review.",
  },
  {
    question: "Does it actually run the code?",
    answer:
      "Yes. Every chat gets its own Linux workspace for up to 48 hours, so it can install dependencies, run typechecks, tests and builds, and serve a live preview. It reports the exit code it actually got.",
  },
  {
    question: "Will it touch my main branch?",
    answer:
      "No. Work lands on an isolated openmi/agent/<id> branch as one commit and one pull request. It never force-pushes, never rewrites history, and stays off your default branch unless you name another one.",
  },
  {
    question: "What does an active hour cost?",
    answer: `${CREDIT_PER_HOUR} Credit per hour, with unlimited follow-up turns inside that hour. If the model provider returns no answer before the first token arrives, the hour is released back to your balance.`,
  },
  {
    question: "Do I need a card or an API key?",
    answer: `No. Signing in with GitHub gives you ${DAILY_FREE_CREDIT} free Credit every day — ${Math.floor(DAILY_FREE_CREDIT / CREDIT_PER_HOUR)} active hours — plus a ${TRIAL_CREDIT} Credit trial on your first turn. Fixed-term passes are optional and never auto-renew.`,
  },
  {
    question: "Which models can it use?",
    answer: `DeepSeek V4.1 Flash and GPT-OSS 120B on the free tier, Claude Haiku 4.5 with a pass. You pick the model per thread, and every one of them bills at ${CREDIT_PER_HOUR} Credit per hour.`,
  },
  {
    question: "What happens when it gets a change wrong?",
    answer:
      "You see the diff and the commands it ran before anything merges. Ask for a fix and it works in the same sandbox, reruns the check, and updates the same pull request. Nothing reaches your default branch without you.",
  },
  {
    question: "Where does my code run?",
    answer:
      "In a sandboxed Linux workspace attached to that chat, with its own filesystem and a 48-hour lifetime. The repository is cloned there; the only thing written back to GitHub is the branch of the pull request you review.",
  },
  {
    question: "Can I watch it work?",
    answer:
      "Yes. Each turn streams its tool calls, the sandbox output and the resulting diff, and the dev server it starts can be previewed while the agent keeps editing.",
  },
  {
    question: "How do I start?",
    answer: `Sign in with GitHub, pick a repository, describe the change. Your first turn is ${TRIAL_CREDIT} Credit, then ${DAILY_FREE_CREDIT} free Credit refills daily — no card and no API keys.`,
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
        <section className="pt-32 pb-6 sm:pt-40">
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

            <p className="qa-kicker">
              Openmi · {CREDIT_PER_HOUR} Credit per active hour
            </p>

            <h1 className="display-xl mt-5 max-w-[24ch]">
              Questions, answered before you let an agent{" "}
              <span className="accent-word">run your repo.</span>
            </h1>

            <div className="mt-9 flex flex-wrap items-center gap-3">
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

        {/* ── The whole page: one scroll-filled set of questions ─────────── */}
        <section aria-labelledby="answers-h" className="pb-16 sm:pb-24">
          <div className="lp-wrap">
            <h2 id="answers-h" className="sr-only">
              Common questions about Openmi
            </h2>
            <ScrollFillText items={HOME_FAQS} className="qa-flow" />
          </div>
        </section>

        {/* ── Close ─────────────────────────────────────────────────────── */}
        <section className="pb-20 sm:pb-28">
          <div className="lp-wrap">
            <div className="qa-close">
              <div>
                <h2 className="display-lg max-w-[20ch]">
                  Ask for the change. Review the pull request.
                </h2>
                <p className="mt-4 max-w-[44ch] text-[16.5px] leading-[1.6] text-mid">
                  {DAILY_FREE_CREDIT} free Credit every day, {TRIAL_CREDIT} on
                  the first turn. Passes add {PAID_DAILY_FREE_CREDIT} Credit a
                  day and end when they end.
                </p>
                <p className="mt-3 font-mono text-[12.5px] text-low">
                  {PLANS.map((plan) => `${plan.name} RM ${plan.price}`).join(
                    " · "
                  )}
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
          </div>
        </section>
      </main>

      {/* ── Footer, on the bone ground ─────────────────────────────────── */}
      <footer className="border-t border-line pt-16 pb-12" aria-labelledby="close-h">
        <div className="lp-wrap">
          <h2 id="close-h" className="sr-only">
            Openmi
          </h2>

          <p aria-hidden="true" className="wordmark select-none pb-8">
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
