import { Check, XCircle } from "lucide-react";
import Link from "next/link";

import { AboutLogoGate } from "@/components/AboutLogoGate";
import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
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
import { APP_VERSION_TAG, CHANGELOG } from "@/lib/version";

export const metadata = {
  title: "About — Openmi",
};

const DOES = [
  "Reads repo files at the pinned commit SHA.",
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
  "No guest mode — requires an account and repository.",
  "Never stores card details; payments run on hosted checkout.",
];

export default function AboutPage() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-2 px-5 sm:px-8">
          <Link href="/" aria-label="Openmi home">
            <Brand />
          </Link>
          <nav className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link href="/chat" className="btn px-3.5 py-1.5 text-[12.5px]">
              Open workspace
            </Link>
          </nav>
        </div>
      </header>

      <main className="animate-enter mx-auto w-full max-w-4xl px-5 py-10 sm:px-8">
        <section
          aria-label="Openmi"
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-card py-10 shadow-[var(--card-shadow)]"
        >
          <AboutLogoGate />
          <VersionBadge />
        </section>

        <div className="mt-10 border-b border-line pb-6">
          <h1 className="max-w-2xl text-balance text-[clamp(1.9rem,4.5vw,2.75rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
            Capabilities &amp; boundaries
          </h1>
          <p className="mt-3 max-w-xl text-[14.5px] leading-[1.6] text-mid">
            One GitHub repo per thread, pinned commits, isolated PRs.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <section className="panel p-6">
            <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3">
              <h2 className="text-[15.5px] font-semibold tracking-[-0.02em] text-hi">
                Capabilities
              </h2>
              <span className="font-mono text-[11px] text-low">
                {String(DOES.length).padStart(2, "0")} guarantees
              </span>
            </div>
            <ul className="mt-4 space-y-3">
              {DOES.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check
                    aria-hidden="true"
                    className="mt-1 size-3.5 shrink-0 text-accent-text"
                    strokeWidth={2}
                  />
                  <span className="text-[13px] leading-relaxed text-mid">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel p-6">
            <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3">
              <h2 className="text-[15.5px] font-semibold tracking-[-0.02em] text-hi">
                Explicit boundaries
              </h2>
              <span className="font-mono text-[11px] text-low">Refusals</span>
            </div>
            <ul className="mt-4 space-y-3">
              {DOES_NOT.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <XCircle
                    aria-hidden="true"
                    className="mt-1 size-3.5 shrink-0 text-danger"
                    strokeWidth={1.75}
                  />
                  <span className="text-[13px] leading-relaxed text-mid">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="mt-10 border-t border-line pt-8">
          <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-hi">
            Credit &amp; passes
          </h2>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-mid">
            {CREDIT_PER_HOUR} Credit/hr (unlimited follow-ups). Daily allowance:{" "}
            {DAILY_FREE_CREDIT} Credit free, {PAID_DAILY_FREE_CREDIT} Credit
            with an active pass. Trial: {TRIAL_CREDIT} Credit (1/IP/24h). Low
            warning under {LOW_BALANCE_CREDIT} Credit. Invites grant{" "}
            {INVITE_REWARD_CREDIT} Credit to both sides on the invitee&apos;s
            first paid pass (max {MAX_INVITES_PER_ACCOUNT}).
          </p>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-mid">
            Passes never auto-renew and are non-refundable (provider failures
            before the first token auto-refund). See{" "}
            <Link
              href="/activity"
              className="font-medium text-accent-text underline-offset-2 hover:underline"
            >
              activity
            </Link>{" "}
            and{" "}
            <Link
              href="/refunds"
              className="font-medium text-accent-text underline-offset-2 hover:underline"
            >
              refund terms
            </Link>
            .
          </p>
        </section>

        <section id="changelog" className="mt-10 border-t border-line pt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-hi">
              Version &amp; changelog
            </h2>
            <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-accent-text">
              {APP_VERSION_TAG}
            </span>
          </div>

          <div className="mt-4 space-y-4">
            {CHANGELOG.map((entry) => (
              <div key={entry.version} className="panel p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[11.5px] font-semibold tabular-nums text-hi">
                      v{entry.version}
                    </span>
                    <h3 className="text-[14px] font-semibold text-hi">
                      {entry.title}
                    </h3>
                  </div>
                  <time
                    dateTime={entry.date}
                    className="font-mono text-[11.5px] tabular-nums text-low"
                  >
                    {entry.date}
                  </time>
                </div>

                <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-mid">
                  {entry.changes.map((change) => (
                    <li key={change} className="flex items-start gap-2.5">
                      <Check
                        aria-hidden="true"
                        className="mt-1 size-3.5 shrink-0 text-accent-text"
                        strokeWidth={2}
                      />
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-[12.5px]">
          <div className="flex items-center gap-3">
            <p className="font-mono text-low">© 2026 Openmi</p>
            <VersionBadge />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-mid">
            <Link href="/report" className="hover:text-hi">
              Report a problem
            </Link>
            <Link href="/suggestions" className="hover:text-hi">
              Suggestions
            </Link>
            <Link href="/terms" className="hover:text-hi">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-hi">
              Privacy
            </Link>
            <Link href="/refunds" className="hover:text-hi">
              Refunds
            </Link>
            <Link href="/" className="hover:text-hi">
              Home
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
