import Link from "next/link";

import { Brand } from "@/components/Brand";
import { AGENT_BRANCH_PREFIX } from "@/lib/branch";
import {
  DAILY_FREE_DEW,
  DEW_PER_HOUR,
  INVITE_REWARD_DEW,
  LOW_BALANCE_DEW,
  MAX_INVITES_PER_ACCOUNT,
  PAID_DAILY_FREE_DEW,
  TRIAL_DEW,
} from "@/lib/dew";

export const metadata = {
  title: "About — Openmi",
};

const DOES = [
  "Reads repository files at a pinned commit through a GET-only GitHub client.",
  "Answers with path:line citations that are checked against the tree at that commit.",
  "Proposes edits as per-file unified diffs; you accept or reject each file.",
  `Approval opens one branch named ${AGENT_BRANCH_PREFIX}<changeset-id> and one pull request.`,
  `Charges ${DEW_PER_HOUR} Dew for an hour of chat before the provider is called, and records every change in a ledger.`,
];

const DOES_NOT = [
  "It does not run code, tests, builds, a sandbox or a preview server.",
  "It does not write to the default branch. The write client refuses it, and a test asserts the refusal.",
  "It does not merge pull requests, push to a protected branch or clean up branches.",
  "It does not generate a project from nothing, and there is no guest mode.",
  "It does not take card payments; top-ups are operator-issued redeem codes.",
  "It does not verify a change. No card claims that a test ran, because none did.",
];

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <Brand compact />
        <div className="flex items-center gap-4 text-[13px] text-mid">
          <Link href="/setup" className="transition-colors hover:text-hi">
            Setup
          </Link>
          <Link href="/" className="transition-colors hover:text-hi">
            Back
          </Link>
        </div>
      </header>

      <h1 className="mt-10 text-2xl font-semibold tracking-tight text-hi">
        What Openmi does, and what it does not
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mid">
        Openmi is a chat client welded to one GitHub repository. It reads the
        code, answers with real paths and line numbers, and proposes edits for
        you to review. Nothing reaches GitHub until you approve it.
      </p>

      <section className="mt-8 rounded-xl border border-line bg-card p-5">
        <h2 className="text-[14px] font-semibold text-hi">What it does</h2>
        <ul className="mt-3 space-y-2">
          {DOES.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[13px] leading-relaxed text-mid">
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-xl border border-line bg-card p-5">
        <h2 className="text-[14px] font-semibold text-hi">What it does not do</h2>
        <ul className="mt-3 space-y-2">
          {DOES_NOT.map((item) => (
            <li key={item} className="flex items-start gap-2 text-[13px] leading-relaxed text-mid">
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-xl border border-line bg-card p-5">
        <h2 className="text-[14px] font-semibold text-hi">Branch policy</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          The head branch is derived from the changeset, never supplied by the
          caller:{" "}
          <span className="font-mono text-[12px] text-body">
            {AGENT_BRANCH_PREFIX}&lt;changeset-id&gt;
          </span>
          . A default branch or any other name is refused with{" "}
          <span className="font-mono text-[12px] text-body">
            Openmi only commits to agent/ branches.
          </span>{" "}
          The pull request is opened against the repository&apos;s default
          branch, which is only ever the base — never the head.
        </p>
      </section>

      <section className="mt-4 rounded-xl border border-line bg-card p-5">
        <h2 className="text-[14px] font-semibold text-hi">What an hour costs</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          One hour of chat costs {DEW_PER_HOUR} Dew, charged once before the
          provider call. More turns inside the hour are free. The daily allowance
          is {DAILY_FREE_DEW} Dew, or {PAID_DAILY_FREE_DEW} once a top-up has been
          redeemed; new accounts start with a {TRIAL_DEW} Dew trial credit. The
          balance turns amber below {LOW_BALANCE_DEW} Dew. An invite rewards both
          sides {INVITE_REWARD_DEW} Dew, up to {MAX_INVITES_PER_ACCOUNT} rewarded
          accounts per inviter.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          A refund is recorded when a provider fails or a turn is stopped before
          the first token. An hour that produced part of an answer is not
          refunded. Everything is an append-only ledger row on{" "}
          <Link href="/activity" className="text-accent underline-offset-2 hover:underline">
            the activity page
          </Link>
          .
        </p>
      </section>

      <section className="mt-4 rounded-xl border-2 border-line-strong bg-raised p-5">
        <h2 className="text-[14px] font-semibold text-hi">The honesty rule</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          The review card states what the model proposed and what you approved.
          It never claims a build, test, check or deployment ran. There is no
          execution environment in this build, and the setup page tells you
          exactly which configuration is missing instead of failing silently.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Full environment and migration status live on{" "}
          <Link href="/setup" className="text-accent underline-offset-2 hover:underline">
            the setup page
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
