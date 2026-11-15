import Link from "next/link";

import { deleteAccount } from "@/app/account/actions";
import { Brand } from "@/components/Brand";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { getSession } from "@/lib/session";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Delete your account — Openmi",
  description:
    "Delete your Openmi account and the data we hold for it yourself. No request form, no waiting for a reply: sign in, confirm, and the account and its data are removed.",
};

/**
 * The delete-on-request path.
 *
 * A policy that says "write to us and we will delete it" is a promise with no
 * way to keep it visible from the outside, and a scan — reasonably — reports
 * that no deletion path exists. This page is the path: it names exactly what is
 * removed, what is kept, and gives a signed-in reader the action itself instead
 * of a mailbox. The address stays as the fallback for someone who can no longer
 * sign in, because an account nobody can authenticate to still has to be
 * deletable.
 */

const REMOVED = [
  "Your profile, email address and preferences.",
  "Every chat, its messages, folders and pinned repository.",
  "The sealed GitHub token and the connection it belongs to.",
  "Uploaded receipts and the payment requests attached to them.",
  "Run records, checkpoints, sandboxes and preview addresses.",
  "The Dew ledger, balance, invites and pass history.",
];

const KEPT = [
  "Moderation and operator actions are kept without your identity, so an abuse decision cannot be erased by deleting the account that caused it.",
  "Backups and diagnostic logs may still hold a copy for a limited period before they rotate.",
];

export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [params, session] = await Promise.all([searchParams, getSession()]);

  // A stopped account is still an account with data. It is not sent back to
  // sign-in — it is told to write in, because the middleware and the ban both
  // block the signed-in surfaces that would hold the form.
  if (session.state === "banned") {
    return (
      <Shell>
        <h1 className="mt-3 text-[clamp(1.8rem,4.6vw,2.6rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
          Delete your account
        </h1>
        <p className="mt-4 text-[13.5px] leading-relaxed text-mid">
          This account is currently stopped, so the self-serve form is closed.
          Write to{" "}
          <a
            href={supportMailto("Delete my account")}
            className="break-words text-accent-text underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          from the address on the account and we will delete the account and its
          data for you.
        </p>
      </Shell>
    );
  }

  if (session.state === "unconfigured") {
    return (
      <Shell>
        <h1 className="mt-3 text-[clamp(1.8rem,4.6vw,2.6rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
          Delete your account
        </h1>
        <p className="mt-4 text-[13.5px] leading-relaxed text-mid">
          Openmi is unavailable right now, so deletion cannot be completed on
          this deployment. Try again shortly, or write to{" "}
          <a
            href={supportMailto("Delete my account")}
            className="break-words text-accent-text underline-offset-2 hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Shell>
    );
  }

  const signedIn = session.state === "signed-in";

  return (
    <Shell>
      <p className="mt-10 text-[12px] font-mono uppercase tracking-[0.14em] text-low">
        your data
      </p>
      <h1 className="mt-3 text-balance text-[clamp(1.9rem,5vw,2.9rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
        Delete your account and its data.
      </h1>
      <p className="mt-4 max-w-2xl text-pretty text-[13.5px] leading-relaxed text-mid">
        This removes the account you signed up with and everything we hold under
        it. It happens immediately and cannot be undone. You do not need to give
        a reason, and you do not need to ask us first.
      </p>

      {params.error && (
        <p
          role="alert"
          className="mt-5 rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12px] leading-relaxed text-danger"
        >
          {params.error}
        </p>
      )}

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          What is deleted
        </h2>
        <ul className="mt-3 space-y-2">
          {REMOVED.map((item) => (
            <li key={item} className="flex items-start gap-3 text-[13px] leading-relaxed text-mid">
              <span
                aria-hidden="true"
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-danger"
              />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-hi">
          What remains
        </h2>
        <ul className="mt-3 space-y-2">
          {KEPT.map((item) => (
            <li key={item} className="flex items-start gap-3 text-[13px] leading-relaxed text-mid">
              <span
                aria-hidden="true"
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-line-strong"
              />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 max-w-2xl text-[11.5px] leading-relaxed text-low">
          This is the same list the{" "}
          <Link href="/privacy#retention" className="text-accent-text underline-offset-2 hover:underline">
            privacy policy
          </Link>{" "}
          describes. Deleting an account does not refund an unspent Dew balance
          or an unexpired pass; the{" "}
          <Link href="/refunds" className="text-accent-text underline-offset-2 hover:underline">
            refund and cancellation policy
          </Link>{" "}
          explains why.
        </p>
      </section>

      <section className="mt-10 rounded-3xl border border-danger/25 bg-danger/5 p-5 sm:p-6">
        <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-danger">
          {signedIn ? "Delete this account now" : "Sign in to delete"}
        </h2>

        {signedIn ? (
          <>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-mid">
              Signed in as{" "}
              <span className="break-all font-mono text-[11.5px] text-hi">
                {session.user.email ?? "an account without an address"}
              </span>
              . Type <span className="font-mono text-hi">DELETE</span> to confirm.
              There is no second step and no undo.
            </p>

            <form action={deleteAccount} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="confirm">
                Type DELETE to confirm
              </label>
              <input
                id="confirm"
                name="confirm"
                required
                maxLength={20}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="DELETE"
                className="field w-full py-2 font-mono text-[12px] sm:max-w-[200px]"
              />
              <SubmitButton
                className="btn py-2.5 text-[12.5px] text-danger"
                optimisticText="Deleting…"
                pendingText="Deleting your account…"
              >
                Delete my account
              </SubmitButton>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-mid">
              The form needs your session so it deletes the right account and
              nothing else. Sign in, then come back to this page.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href="/login?next=%2Faccount%2Fdelete"
                className="btn btn-primary px-4 py-2 text-[12.5px]"
              >
                Sign in to continue
              </Link>
              <a
                href={supportMailto("Delete my account")}
                className="btn px-4 py-2 text-[12.5px]"
              >
                Or write to support
              </a>
            </div>
            <p className="mt-3 max-w-xl text-[11px] leading-relaxed text-low">
              If you no longer have access to the mailbox or the GitHub account
              you signed up with, write from any address you can still use and
              tell us what you remember about the account; we will confirm
              ownership before deleting it.
            </p>
          </>
        )}
      </section>

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6">
        <p className="eyebrow">openmi · your data, your call</p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/privacy" className="eyebrow hover:text-hi">
            privacy
          </Link>
          <Link href="/refunds" className="eyebrow hover:text-hi">
            refunds
          </Link>
          <Link href="/" className="eyebrow hover:text-hi">
            home
          </Link>
        </div>
      </footer>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="animate-enter mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-2">
        <Link href="/" aria-label="Openmi home">
          <Brand />
        </Link>
        <ThemeSwitcher variant="icon" />
      </header>
      {children}
    </main>
  );
}
