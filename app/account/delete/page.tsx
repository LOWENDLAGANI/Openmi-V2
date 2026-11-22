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
  robots: { index: false, follow: false },
};

const REMOVED = [
  "Your profile, email address, and preferences.",
  "Every chat, its messages, folders, and pinned repository.",
  "The sealed GitHub token and the connection it belongs to.",
  "Uploaded receipts and the payment requests attached to them.",
  "Run records, checkpoints, sandboxes, and preview addresses.",
  "The Credit ledger, balance, invites, and pass history.",
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

  if (session.state === "banned") {
    return (
      <Shell>
        <h1 className="text-[clamp(1.8rem,4.5vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-hi">
          Delete your account
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-mid">
          This account is currently suspended, so the self-serve form is
          closed. Write to{" "}
          <a
            href={supportMailto("Delete my account")}
            className="break-words font-medium text-accent-text underline-offset-2 hover:underline"
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
        <h1 className="text-[clamp(1.8rem,4.5vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-hi">
          Delete your account
        </h1>
        <p className="mt-4 text-[14px] leading-relaxed text-mid">
          Openmi is unavailable right now, so deletion cannot be completed on
          this deployment. Try again shortly, or write to{" "}
          <a
            href={supportMailto("Delete my account")}
            className="break-words font-medium text-accent-text underline-offset-2 hover:underline"
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
      <p className="text-[12px] font-medium text-danger">Your data</p>
      <h1 className="mt-2 text-balance text-[clamp(1.9rem,4.5vw,2.65rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-hi">
        Delete your account and its data
      </h1>
      <p className="mt-4 max-w-2xl text-pretty text-[14px] leading-[1.65] text-mid">
        This removes the account you signed up with and everything we hold under
        it immediately and permanently.
      </p>

      {params.error && (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-danger/30 bg-danger/8 px-4 py-2.5 text-[12.5px] leading-relaxed text-danger"
        >
          {params.error}
        </p>
      )}

      <section className="mt-10 border-t border-line pt-6">
        <h2 className="text-[15.5px] font-semibold tracking-[-0.015em] text-hi">
          What is deleted
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[13.5px] leading-relaxed text-mid marker:text-danger">
          {REMOVED.map((item) => (
            <li key={item} className="min-w-0 break-words">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-[15.5px] font-semibold tracking-[-0.015em] text-hi">
          What remains
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[13.5px] leading-relaxed text-mid marker:text-line-strong">
          {KEPT.map((item) => (
            <li key={item} className="min-w-0 break-words">
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-2xl text-[12.5px] leading-relaxed text-low">
          This matches the{" "}
          <Link
            href="/privacy#retention"
            className="font-medium text-accent-text underline-offset-2 hover:underline"
          >
            privacy policy
          </Link>
          . Deleting an account does not refund an unspent Credit balance or an
          unexpired pass; see the{" "}
          <Link
            href="/refunds"
            className="font-medium text-accent-text underline-offset-2 hover:underline"
          >
            refund and cancellation policy
          </Link>
          .
        </p>
      </section>

      <section className="mt-8 rounded-xl border border-danger/30 bg-danger/5 p-6">
        <h2 className="text-[15.5px] font-semibold tracking-[-0.015em] text-danger">
          {signedIn ? "Delete this account now" : "Sign in to delete"}
        </h2>

        {signedIn ? (
          <>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-mid">
              Signed in as{" "}
              <span className="break-all font-mono text-[12px] text-hi">
                {session.user.email ?? "an account without an address"}
              </span>
              . Type <code className="rounded bg-card px-1.5 py-0.5 font-mono text-hi">DELETE</code>{" "}
              to confirm. This action cannot be undone.
            </p>

            <form action={deleteAccount} className="mt-4 flex flex-col gap-2.5 sm:flex-row">
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
                className="field w-full py-2 font-mono text-[12.5px] sm:max-w-[200px]"
              />
              <SubmitButton
                className="btn border-danger/40 bg-danger/10 py-2 text-[12.5px] font-medium text-danger hover:bg-danger/15"
                optimisticText="Deleting…"
                pendingText="Deleting your account…"
              >
                Delete my account
              </SubmitButton>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-mid">
              Authentication is required so only the account holder can trigger
              deletion. Sign in, then return to this page.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
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
            <p className="mt-3 max-w-xl text-[12px] leading-relaxed text-low">
              If you lost access to your mailbox or GitHub account, write from
              any reachable address and tell us what you remember about the
              account so we can confirm ownership before removing it.
            </p>
          </>
        )}
      </section>

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-[12.5px]">
        <p className="font-mono text-low">© 2026 Openmi</p>
        <div className="flex flex-wrap items-center gap-4 text-mid">
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
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-2 px-5 sm:px-8">
          <Link href="/" aria-label="Openmi home">
            <Brand />
          </Link>
          <ThemeSwitcher variant="icon" />
        </div>
      </header>
      <main className="animate-enter mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        {children}
      </main>
    </div>
  );
}
