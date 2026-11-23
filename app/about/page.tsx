import { Check, XCircle } from "lucide-react";
import Link from "next/link";

import { AboutLogoGate } from "@/components/AboutLogoGate";
import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
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

export const metadata = {
  title: "About — Openmi",
};

const DOES = [
  "Reads repository files at the commit a chat is pinned to.",
  "Answers with path:line citations verified against the tree at that commit.",
  "Writes edits as per-file unified diffs against the commit the chat is pinned to.",
  `When a turn finishes with a change, writes it to ${AGENT_BRANCH_PREFIX}<changeset-id>, opens one pull request, and squash-merges it, recording the merge commit.`,
  "Runs installs, builds, and requested commands in an isolated Linux sandbox and reports the exact exit code observed.",
  `Charges ${CREDIT_PER_HOUR} Credit for an hour of chat before the provider is called, recording every change in an append-only ledger.`,
];

const DOES_NOT = [
  "It does not run your test suite as a verification step. It runs installs and builds in its sandbox, reports the observed exit code, and never claims a test that did not run.",
  "It does not write to the default branch unless you name it as the destination or an operator enables default-branch writes for unattended runs.",
  "It does not force-push a branch, merge a pull request it did not open, or delete branches.",
  "It does not generate a project without an account or repository; there is no guest mode.",
  "It does not collect card details in this app; payments run on the hosted checkout page, and top-ups arrive via redeem codes or approved receipts.",
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
          className="flex flex-col items-center justify-center rounded-xl border border-line bg-card py-10 shadow-[var(--card-shadow)]"
        >
          <AboutLogoGate />
        </section>

        <div className="mt-10 border-b border-line pb-8">
          <h1 className="max-w-2xl text-balance text-[clamp(1.9rem,4.5vw,2.75rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
            What Openmi does, and what it refuses to do
          </h1>
          <p className="mt-4 max-w-2xl text-[14.5px] leading-[1.65] text-mid">
            Openmi is a workspace bound to a single GitHub repository per thread.
            It inspects code at a pinned commit, cites real file paths and line
            numbers, and writes edits to an isolated branch with a pull request.
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
            Branch policy
          </h2>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-mid">
            The head branch is derived from the changeset identifier:{" "}
            <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12px] text-hi">
              {AGENT_BRANCH_PREFIX}&lt;changeset-id&gt;
            </code>
            . The pull request targets the repository&apos;s default branch, and
            the turn squash-merges it. Naming a custom branch writes there
            directly without opening a pull request; naming the default branch
            explicitly requests a direct write. Any branch name is validated
            against git&apos;s branch naming rules before a request is made.
          </p>
        </section>

        <section className="mt-8 border-t border-line pt-8">
          <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-hi">
            Hourly pricing &amp; Credit
          </h2>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-mid">
            One hour of chat costs {CREDIT_PER_HOUR} Credit, charged once before
            the model provider is called. Further turns
            inside that hour carry no charge. The daily allowance is{" "}
            {DAILY_FREE_CREDIT} Credit, or {PAID_DAILY_FREE_CREDIT} while a paid
            plan is active. A {TRIAL_CREDIT} Credit trial credit is granted once
            per account, capped at one trial per address in any 24-hour window.
            The balance indicator warns below {LOW_BALANCE_CREDIT} Credit. An
            invite rewards both accounts {INVITE_REWARD_CREDIT} Credit once the
            invited account activates its first paid pass, up to{" "}
            {MAX_INVITES_PER_ACCOUNT} rewarded accounts per inviter.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-mid">
            Every purchase is final: Credit, plans, and passes are non-refundable
            and never auto-renew. If the model provider returns no answer at all,
            the hour is automatically returned to your balance by the meter; a
            turn stopped after text arrived keeps its hour because the partial
            answer is preserved. Every change appears as an append-only ledger
            entry on{" "}
            <Link
              href="/activity"
              className="font-medium text-accent-text underline-offset-2 hover:underline"
            >
              the activity page
            </Link>
            . Read the{" "}
            <Link
              href="/refunds"
              className="font-medium text-accent-text underline-offset-2 hover:underline"
            >
              refund and cancellation policy
            </Link>{" "}
            for full terms.
          </p>
        </section>

        <section className="panel mt-8 p-6">
          <h2 className="text-[15.5px] font-semibold tracking-[-0.02em] text-hi">
            What every transcript reports
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-mid">
            Every transcript states directly what the turn accomplished: the
            branch written, the pull request opened or merged, and the exit code
            of any sandbox command. Unobserved checks or deployments are never
            claimed, and a turn that modified no files states that clearly.
          </p>
        </section>

        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-[12.5px]">
          <p className="font-mono text-low">© 2026 Openmi</p>
          <div className="flex flex-wrap items-center gap-4 text-mid">
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
