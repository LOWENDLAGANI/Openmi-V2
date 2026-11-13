import Link from "next/link";

import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export const metadata = {
  title: "Privacy Policy — Openmi",
  description:
    "How Openmi collects, uses, shares and protects your data, including GitHub tokens, chats, billing records and sandbox runs.",
};

const LAST_UPDATED = "November 12, 2026";

export default function PrivacyPage() {
  return (
    <main className="animate-enter mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-2">
        <Link href="/" aria-label="Openmi home">
          <Brand />
        </Link>
        <nav className="flex items-center gap-1.5">
          <ThemeSwitcher variant="icon" />
          <Link href="/terms" className="btn px-3.5 py-1.5 text-[12px]">
            Terms
          </Link>
        </nav>
      </header>

      <p className="eyebrow mt-10">legal</p>
      <h1 className="mt-3 text-[clamp(1.9rem,5vw,2.9rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
        Privacy Policy
      </h1>
      <p className="mt-3 text-[12px] font-mono uppercase tracking-[0.12em] text-low">
        Last updated {LAST_UPDATED}
      </p>
      <p className="mt-4 text-[14px] leading-relaxed text-mid">
        This policy explains what Openmi collects, how it is used, who it is
        shared with, and what choices you have. It applies to the service at
        every deployment origin we operate.
      </p>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          1. What we collect
        </h2>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-mid">
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              Account data: your email address and the password hash stored by
              Supabase Auth, plus a profile row created when you sign in.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              GitHub connection: the token you provide or the OAuth grant, sealed
              on the server with AES-256-GCM, along with your GitHub username,
              the granted scopes and the repositories you select.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              Chats and code: the messages you send, the model replies, the
              repository and commit a chat is pinned to, the files the model
              reads, and the diffs and changesets it proposes.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              Billing records: your Dew balance, the append-only ledger of
              charges, refunds, daily allowances, invites and redeem codes, plus
              payment requests and uploaded receipts for paid plans.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              Execution records: sandbox runs, their commands, exit codes,
              durations, output tails, checkpoints, preview URLs and mission
              transcripts when those features are enabled.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              Technical data: request metadata, rate-limit counters, error logs
              and the session cookie. We do not run third-party analytics by
              default.
            </span>
          </li>
        </ul>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          2. How we use it
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          We use this data to authenticate you, to read and propose changes to
          the repositories you connect, to charge and account for Dew, to run
          sandbox verification when you ask for it, to send operational email
          such as receipt notifications, to enforce rate limits and abuse rules,
          and to diagnose faults. We do not sell your personal data. Model
          providers receive only the prompts and code needed to answer; we do not
          train our own models on your data, and providers' own retention and
          training practices are governed by their terms.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          3. Sharing and subprocessors
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          To operate the service we share data with the following providers, each
          under their own terms:
        </p>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-mid">
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              Supabase (database, authentication, storage) and Vercel (hosting).
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              GitHub, for repository metadata and file contents at the pinned
              commit.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              The model provider you select, which receives your prompt and the
              code needed to answer it. Auto routes across many providers.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              E2B, which runs installs and builds inside disposable sandboxes
              when verification is enabled.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              Resend, which delivers operational email, and Upstash, which holds
              rate-limit counters.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              Adsterra, which serves banner advertisements and may set its own
              cookies in your browser.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
            <span>
              The hosted payment page provider you use for paid plans.
            </span>
          </li>
        </ul>
        <p className="mt-3 text-[13px] leading-relaxed text-mid">
          We may also disclose data when required by law, to protect the service
          or its users, or with your consent.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          4. Cookies and local storage
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          The session lives in an httpOnly cookie set by Supabase SSR, which is
          what lets the server redirect a signed-out visitor before paint. Your
          theme choice is stored in localStorage. Advertising partners may set
          their own cookies only after you accept the cookie banner; you can
          decline them there, and you can change your choice by clearing site
          data in your browser. Clearing cookies signs you out.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          5. Data retention
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          We keep your account and its data for as long as the account exists.
          Deleting the account removes the profile, chats, connections and
          balances we control; backups and audit logs may persist for a limited
          period. Sandbox disks are destroyed after their configured lifetime.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          6. Security
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          GitHub tokens are sealed with AES-256-GCM before storage, traffic is
          served over HTTPS, and every table is protected by row-level security
          keyed to your account. No system is perfectly secure, and you should
          treat model output and generated code as untrusted until reviewed.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          7. Your choices and rights
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          You may access, correct or delete your data, and you may disconnect
          GitHub or close your account at any time by writing to{" "}
          <a
            href={supportMailto("Privacy request")}
            className="text-accent-text underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
          . Where local law grants rights such as access, portability, objection
          or erasure, you may exercise them through the same channel. We will
          respond within a reasonable time.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          8. Children
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          The service is not intended for children under 16, and we do not
          knowingly collect their personal data. If you believe a child has
          provided data, contact us and we will delete it.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          9. International transfers
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Data may be processed in the regions where our providers operate, which
          may differ from your own. We rely on those providers&apos; safeguards
          for cross-border transfers.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          10. Changes to this policy
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          We may update this policy. The updated version will be posted on this
          page with a new date. Material changes will be flagged in the product.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          11. Contact
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Privacy questions and requests:{" "}
          <a
            href={supportMailto("Privacy question")}
            className="text-accent-text underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6">
        <p className="eyebrow">openmi · review before push</p>
        <div className="flex items-center gap-3">
          <Link href="/terms" className="eyebrow hover:text-hi">
            terms
          </Link>
          <Link href="/" className="eyebrow hover:text-hi">
            home
          </Link>
        </div>
      </footer>
    </main>
  );
}