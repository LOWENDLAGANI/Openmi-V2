import Link from "next/link";

import { AboutLogoGate } from "@/components/AboutLogoGate";
import { SiteHeader } from "@/components/SiteHeader";
import { VersionBadge } from "@/components/VersionBadge";
import { AGENT_BRANCH_PREFIX } from "@/lib/branch";
import {
  CREDIT_PER_HOUR,
  DAILY_FREE_CREDIT,
  INVITE_REWARD_CREDIT,
  LOW_BALANCE_CREDIT,
  MAX_INVITES_PER_ACCOUNT,
  PAID_DAILY_FREE_CREDIT,
  TRIAL_CREDIT,
} from "@/lib/credits";
import { breadcrumbJsonLd, pageMetadata, serializeJsonLd } from "@/lib/seo";
import { APP_VERSION_TAG, CHANGELOG } from "@/lib/version";

export const metadata = pageMetadata({
  path: "/about",
  title: "How Openmi Works: Sandbox Limits & PR Workflow | Openmi",
  description: `How Openmi reads pinned GitHub commits, writes isolated pull requests on ${AGENT_BRANCH_PREFIX}<id>, runs Linux sandboxes, and bills ${CREDIT_PER_HOUR} Credit/hr.`,
});

const DOES = [
  "Reads repository files at the pinned commit SHA.",
  "Cites real path:line locations from that commit.",
  "Outputs per-file unified diffs.",
  `Writes changes to ${AGENT_BRANCH_PREFIX}<changeset-id>, opens one PR, and squash-merges it.`,
  "Runs installs and builds in a Linux sandbox and reports exact exit codes.",
  `Charges ${CREDIT_PER_HOUR} Credit/hr in an append-only ledger.`,
];

const DOES_NOT = [
  "Does not run your test suite automatically or fake test passes.",
  "Does not write to your default branch unless explicitly named.",
  "Does not force-push, delete branches, or merge outside PRs.",
  "No guest mode: requires an account and repository.",
  "Never stores card details; payments run on hosted checkout.",
];

export default function AboutPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            breadcrumbJsonLd([
              { name: "Home", path: "/" },
              { name: "About", path: "/about" },
            ])
          ),
        }}
      />

      <SiteHeader currentPath="/about" />

      <main id="main" className="lp-wrap max-w-[960px] pb-20 pt-28 sm:pt-32">
        <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-8">
          <div>
            <h1 className="max-w-[20ch] text-balance text-[clamp(2.1rem,4.2vw,3.15rem)] font-medium leading-[1.06] tracking-[-0.032em] text-hi">
              Capabilities &amp; boundaries
            </h1>
            <p className="mt-3 max-w-[52ch] text-[16px] leading-[1.6] text-mid">
              One GitHub repository per thread, pinned commits, isolated pull requests.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AboutLogoGate />
            <VersionBadge />
          </div>
        </div>

        <div className="mt-12 grid gap-10 md:grid-cols-2">
          <section>
            <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3">
              <h2 className="text-[19px] font-medium tracking-[-0.02em] text-hi">
                Capabilities
              </h2>
              <span className="font-mono text-[12px] text-low">
                {String(DOES.length).padStart(2, "0")} guarantees
              </span>
            </div>
            <ul className="mt-4 divide-y divide-line">
              {DOES.map((item) => (
                <li
                  key={item}
                  className="py-3 text-[15.5px] leading-[1.55] text-body"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3">
              <h2 className="text-[19px] font-medium tracking-[-0.02em] text-hi">
                Explicit boundaries
              </h2>
              <span className="font-mono text-[12px] text-low">Refusals</span>
            </div>
            <ul className="mt-4 divide-y divide-line">
              {DOES_NOT.map((item) => (
                <li
                  key={item}
                  className="py-3 text-[15.5px] leading-[1.55] text-mid"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="mt-14 border-t border-line pt-10">
          <h2 className="text-[20px] font-medium tracking-[-0.02em] text-hi">
            Credit &amp; passes
          </h2>
          <p className="mt-3 max-w-[65ch] text-[16px] leading-[1.65] text-body">
            {CREDIT_PER_HOUR} Credit/hr (unlimited follow-ups). Daily allowance:{" "}
            {DAILY_FREE_CREDIT} Credit free, {PAID_DAILY_FREE_CREDIT} Credit
            with an active pass. Trial: {TRIAL_CREDIT} Credit (1/IP/24h). Low
            warning under {LOW_BALANCE_CREDIT} Credit. Invites grant{" "}
            {INVITE_REWARD_CREDIT} Credit to both sides on the invitee&apos;s
            first paid pass (max {MAX_INVITES_PER_ACCOUNT}).
          </p>
          <p className="mt-3 max-w-[65ch] text-[16px] leading-[1.65] text-mid">
            Passes never auto-renew and are non-refundable (provider failures
            before the first token auto-refund). Compare{" "}
            <Link href="/pricing" className="t-link font-medium text-accent-text">
              free tier and paid pass pricing
            </Link>
            , inspect your{" "}
            <Link href="/activity" className="t-link font-medium text-accent-text">
              activity
            </Link>
            , or read the{" "}
            <Link href="/refunds" className="t-link font-medium text-accent-text">
              refund terms
            </Link>
            .
          </p>
        </section>

        <section id="changelog" className="mt-14 border-t border-line pt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[20px] font-medium tracking-[-0.02em] text-hi">
              Version &amp; changelog
            </h2>
            <span className="rounded-[var(--r-sm)] bg-accent-soft px-2.5 py-0.5 font-mono text-[12px] font-medium tabular-nums text-accent-text">
              {APP_VERSION_TAG}
            </span>
          </div>

          <div className="mt-6 space-y-4">
            {CHANGELOG.map((entry) => (
              <div key={entry.version} className="panel p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-[var(--r-sm)] border border-line bg-raised px-2 py-0.5 font-mono text-[12px] font-medium tabular-nums text-hi">
                      v{entry.version}
                    </span>
                    <h3 className="text-[16px] font-medium text-hi">
                      {entry.title}
                    </h3>
                  </div>
                  <time
                    dateTime={entry.date}
                    className="font-mono text-[12px] tabular-nums text-low"
                  >
                    {entry.date}
                  </time>
                </div>

                <ul className="mt-3 list-disc space-y-2 pl-5 text-[14.5px] leading-[1.6] text-mid marker:text-line-strong">
                  {entry.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line py-8 text-[14px]">
          <div className="flex items-center gap-3">
            <p className="font-mono text-[13px] text-low">© 2026 Openmi</p>
            <VersionBadge />
          </div>
          <div className="flex flex-wrap items-center gap-5 text-mid">
            <Link href="/pricing" className="t-link text-mid hover:text-hi">
              Pricing
            </Link>
            <Link href="/report" className="t-link text-mid hover:text-hi">
              Report a problem
            </Link>
            <Link href="/suggestions" className="t-link text-mid hover:text-hi">
              Suggestions
            </Link>
            <Link href="/terms" className="t-link text-mid hover:text-hi">
              Terms
            </Link>
            <Link href="/privacy" className="t-link text-mid hover:text-hi">
              Privacy
            </Link>
            <Link href="/refunds" className="t-link text-mid hover:text-hi">
              Refunds
            </Link>
            <Link href="/" className="t-link text-mid hover:text-hi">
              Home
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
