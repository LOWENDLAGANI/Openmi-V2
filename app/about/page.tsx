import Link from "next/link";

import { AboutLogoGate } from "@/components/AboutLogoGate";
import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { AGENT_BRANCH_PREFIX } from "@/lib/branch";
import {
  DAILY_FREE_CREDIT,
  CREDIT_PER_HOUR,
  INVITE_REWARD_CREDIT,
  LOW_BALANCE_CREDIT,
  MAX_INVITES_PER_ACCOUNT,
  PAID_DAILY_FREE_CREDIT,
  TRIAL_CREDIT,
} from "@/lib/credits";

export const metadata = {
  title: "About · Openmi",
};

const DOES = [
  "Reads repository files at the commit a chat is pinned to.",
  "Answers with path:line citations that are checked against the tree at that commit.",
  "Writes edits as per-file unified diffs against the commit the chat is pinned to.",
  `When a turn finishes with a change, writes it to one branch named ${AGENT_BRANCH_PREFIX}<changeset-id>, opens one pull request, and squash-merges it, recording the merge commit.`,
  "When a turn runs in a sandbox, it can install dependencies, run a build and run commands you ask for in the chat's own Linux sandbox, and it reports the exit code it observed.",
  `Charges ${CREDIT_PER_HOUR} Credit for an hour of chat (nothing on Auto) before the provider is called, and records every change in a ledger.`,
];

const DOES_NOT = [
  "It does not run your test suite as a verification step. It can install or build in its sandbox and report the exit code it saw, and nothing claims a test that did not run.",
  "It does not write to the default branch unless you name it as the destination, or an operator enables default-branch writes for unattended runs.",
  "It does not force a branch update, merge a pull request it did not open, or clean up branches.",
  "It does not generate a project from nothing, and there is no guest mode.",
  "It does not take card payments in this app; payment happens on the hosted page, and top-ups arrive as redeem codes.",
];

export default function AboutPage() {
  return (
    <main className="animate-enter mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-2">
        <Link href="/" aria-label="Openmi home">
          <Brand />
        </Link>
        <nav className="flex items-center gap-1.5">
          <ThemeSwitcher variant="icon" />
          <Link href="/chat" className="btn px-3.5 py-1.5 text-[12px]">
            Open workspace
          </Link>
        </nav>
      </header>

      <section
        aria-label="Openmi"
        className="mt-10 flex flex-col items-center gap-3 border-y border-line py-10"
      >
        <AboutLogoGate />
      </section>

      <p className="eyebrow mt-10">the contract</p>
      <h1 className="mt-3 max-w-2xl text-balance text-[clamp(1.9rem,5vw,2.9rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
        What Openmi does, and what it does not.
      </h1>
      <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-mid">
        Openmi is a chat client welded to one GitHub repository. It reads the
        code, answers with real paths and line numbers, and writes the edits it
        makes to a branch of its own, opening one pull request. The default
        branch is only ever the base unless you name it as the destination.
      </p>

      <section className="mt-12 border-t border-line pt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
            What it does
          </h2>
          <span className="eyebrow">
            {String(DOES.length).padStart(2, "0")} things
          </span>
        </div>
        <ul className="mt-4 divide-y divide-line">
          {DOES.map((item) => (
            <li key={item} className="flex items-start gap-3 py-3">
              <span
                aria-hidden="true"
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent"
              />
              <span className="text-[13px] leading-relaxed text-mid">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
            What it does not do
          </h2>
          <span className="eyebrow">refusals</span>
        </div>
        <ul className="mt-4 divide-y divide-line">
          {DOES_NOT.map((item) => (
            <li key={item} className="flex items-start gap-3 py-3">
              <span
                aria-hidden="true"
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-danger"
              />
              <span className="text-[13px] leading-relaxed text-mid">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          Branch policy
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          The head branch is derived from the changeset, never supplied by the
          caller:{" "}
          <span className="font-mono text-[12px] text-body">
            {AGENT_BRANCH_PREFIX}&lt;changeset-id&gt;
          </span>
          . The pull request targets the repository&apos;s default branch, and
          the turn squash-merges it. A branch you name is written directly, with
          no pull request; naming the default branch is how you ask for it to be
          written, and an operator can allow that for unattended runs. Any other
          name is checked against git&apos;s own branch rules before a request is
          made.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          What an hour costs
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          One hour of chat costs {CREDIT_PER_HOUR} Credit, or nothing on Auto,
          charged once before the provider call. More turns inside the hour are free. The daily allowance
          is {DAILY_FREE_CREDIT} Credit, or {PAID_DAILY_FREE_CREDIT} while a paid plan is
          active. A {TRIAL_CREDIT} Credit trial credit is granted once per account, with
          at most one trial per address in any 24-hour period. The balance turns
          amber below {LOW_BALANCE_CREDIT} Credit. An invite rewards both sides{" "}
          {INVITE_REWARD_CREDIT} Credit, up to {MAX_INVITES_PER_ACCOUNT} rewarded
          accounts per inviter.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Every purchase is final: Credit, plans and passes are not refundable and
          cannot be cancelled. A pass ends on its own and never renews. If the
          provider never returns an answer at all, that hour is released back to
          your balance by the meter (a correction, not a refund), and a turn
          stopped after text arrived keeps its hour, because the answer is kept.
          Everything is an append-only ledger row on{" "}
          <Link href="/activity" className="text-accent-text underline-offset-2 hover:underline">
            the activity page
          </Link>
          ; the{" "}
          <Link href="/refunds" className="text-accent-text underline-offset-2 hover:underline">
            refund and cancellation policy
          </Link>{" "}
          states the terms.
        </p>
      </section>

      <section className="mt-12 rounded-2xl border border-line bg-card p-5 shadow-[inset_3px_0_0_var(--accent)]">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          What the transcript states
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          The transcript states what the turn did: the branch it wrote, the pull
          request it opened or merged, and the exit code of any command it ran.
          It never claims a test ran as a verification step, because it runs
          installs and builds only, and a deployment it did not observe is never
          mentioned. A turn that wrote nothing says so.
          The admin panel names the configuration that is missing instead of
          failing silently.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Deployment status lives in an internal admin panel, separate from the
          product.
        </p>
      </section>

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6">
        <p className="eyebrow">Openmi</p>
        <div className="flex items-center gap-3">
          <Link href="/terms" className="eyebrow hover:text-hi">
            terms
          </Link>
          <Link href="/privacy" className="eyebrow hover:text-hi">
            privacy
          </Link>
          <Link href="/refunds" className="eyebrow hover:text-hi">
            refunds
          </Link>
          <Link href="/" className="eyebrow hover:text-hi">
            back to the start
          </Link>
        </div>
      </footer>
    </main>
  );
}
