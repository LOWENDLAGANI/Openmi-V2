import Link from "next/link";

import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export const metadata = {
  title: "Terms of Service — Openmi",
  description:
    "The terms that govern your use of Openmi, including accounts, GitHub access, billing in Dew, sandbox verification, and acceptable use.",
};

const LAST_UPDATED = "November 12, 2026";

export default function TermsPage() {
  return (
    <main className="animate-enter mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-2">
        <Link href="/" aria-label="Openmi home">
          <Brand />
        </Link>
        <nav className="flex items-center gap-1.5">
          <ThemeSwitcher variant="icon" />
          <Link href="/privacy" className="btn px-3.5 py-1.5 text-[12px]">
            Privacy
          </Link>
        </nav>
      </header>

      <p className="eyebrow mt-10">legal</p>
      <h1 className="mt-3 text-[clamp(1.9rem,5vw,2.9rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
        Terms of Service
      </h1>
      <p className="mt-3 text-[12px] font-mono uppercase tracking-[0.12em] text-low">
        Last updated {LAST_UPDATED}
      </p>
      <p className="mt-4 text-[14px] leading-relaxed text-mid">
        These terms govern your use of Openmi (&quot;the service&quot;), a chat
        client welded to a GitHub repository. By creating an account or using the
        service you agree to these terms. If you do not agree, do not use the
        service.
      </p>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          1. The service
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Openmi reads files from a repository you connect at a pinned commit,
          answers questions with path and line citations, proposes edits as
          per-file unified diffs, and, when you approve, writes a ready
          changeset to its own branch and opens a pull request. It may also run
          an install and a build in a disposable Linux sandbox and report the
          exit code it observed. It does not run your test suite, and it does not
          claim that it did.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          2. Accounts
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          You must be at least 16 years old to use the service. You are
          responsible for the security of your account and for all activity under
          it. There is no guest mode: every action is tied to an authenticated
          account. You must provide an accurate email address and keep it
          current, because it is used for account recovery and for billing
          notices.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          3. GitHub access
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Connecting GitHub requires a token you provide, or an OAuth grant you
          approve. The token is sealed on the server with AES-256-GCM and only
          its last four characters are ever shown again. You confirm that you have
          the right to connect every repository you select and that your use of
          the service complies with GitHub&apos;s own terms. Openmi only ever
          reads through a GET-only client and writes to a branch it creates; it
          never force-pushes and never writes to your default branch unless you
          name that branch as the destination.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          4. Your content and your repositories
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          You retain all rights to your code, chats and other content. You grant
          Openmi a limited, non-exclusive licence to host, process and transmit
          that content as needed to operate the service, including sending
          prompts and code to the model provider you select and running builds in
          a sandbox. You are responsible for ensuring that content you submit does
          not infringe the rights of others and does not contain secrets you are
          not authorised to share.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          5. Acceptable use
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          You may not use the service to break the law, to attack or probe
          systems you do not own, to harvest or scrape data, to evade rate limits
          or billing, to distribute malware, or to generate content that harms
          others. You may not use the sandbox or preview URLs to run unauthorised
          workloads, to mine cryptocurrency, or to host services for third
          parties. Automated access must respect the published rate limits. We
          may suspend or terminate accounts that breach these rules.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          6. Billing, Dew and refunds
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Chat is priced in Dew: one hour costs a fixed amount, charged before
          the provider is called, and further turns inside that hour are free. A
          daily allowance and a one-time trial credit are granted as described in
          the product. Top-ups are operator-issued redeem codes; there is no card
          payment inside this app, and payment for paid plans happens on a hosted
          page. A refund is recorded only when a provider fails or a turn is
          stopped before the first token. An hour that produced part of an answer
          is not refunded. Dew has no cash value, is not transferable, and may not
          be resold.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          7. Sandbox verification
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          When configured, a ready changeset can be installed and built in a
          disposable Linux sandbox. The run records an exit code, a duration and
          an output tail. It does not run tests, and no card claims a test that
          did not run. Sandbox URLs are public while they run, and preview traffic
          is not authenticated by Openmi. You are responsible for the code you
          run there and for keeping secrets out of it.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          8. Third-party services
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          The service is built on Supabase, Vercel, GitHub, model providers,
          E2B, Resend, Upstash and Adsterra, and paid plans use a hosted payment
          page. Your use of those services is also subject to their own terms. We
          are not responsible for their availability, pricing or conduct.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          9. Intellectual property
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Openmi and its software, branding and documentation are owned by the
          operator. These terms do not grant you any right to use the
          operator&apos;s trademarks or to copy or resell the service. Feedback
          you send may be used without obligation to you.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          10. Disclaimers
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          The service is provided &quot;as is&quot; and &quot;as available&quot;,
          without warranty of any kind, express or implied, including warranties
          of merchantability, fitness for a particular purpose and
          non-infringement. Model output may be incorrect, incomplete or
          insecure, and automated edits are proposed for your review, not
          applied without your approval. You are responsible for reviewing every
          change before it reaches your repository.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          11. Limitation of liability
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          To the maximum extent permitted by law, the operator is not liable for
          any indirect, incidental, special, consequential or punitive damages,
          or for any loss of data, code, profits or revenue, arising from your
          use of the service. The operator&apos;s total liability for any claim
          is limited to the amount you paid to the operator in the twelve months
          before the claim arose.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          12. Termination
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          You may stop using the service and delete your account at any time by
          writing to{" "}
          <a
            href={supportMailto("Close my account")}
            className="text-accent-text underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
          . We may suspend or terminate access for breach of these terms, for
          non-payment of accrued charges, or to protect the service or other
          users. Sections that by their nature should survive termination do
          survive.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          13. Changes to these terms
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          We may update these terms. The updated version will be posted on this
          page with a new date. Continued use of the service after an update
          takes effect constitutes acceptance of the revised terms.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          14. Governing law
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          These terms are governed by the laws of the jurisdiction in which the
          operator is established, without regard to conflict of law principles.
          Any dispute will be resolved in the courts of that jurisdiction.
        </p>
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          15. Contact
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Questions about these terms:{" "}
          <a
            href={supportMailto("Terms question")}
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
          <Link href="/privacy" className="eyebrow hover:text-hi">
            privacy
          </Link>
          <Link href="/" className="eyebrow hover:text-hi">
            home
          </Link>
        </div>
      </footer>
    </main>
  );
}