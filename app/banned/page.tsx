import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Account suspended — Openmi",
  robots: { index: false, follow: false },
};

/**
 * Where a stopped account lands.
 *
 * It is a page rather than a redirect to sign-in because the cookie is valid:
 * the account is real and the stop is a decision, so the honest thing is to say
 * so — with the reason the operator wrote, and when it ends if it ends. Nothing
 * here links back into the product.
 */
export default async function BannedPage() {
  const session = await getSession();

  if (session.state === "signed-in") redirect("/chat");

  const reason = session.state === "banned" ? session.reason : null;
  const until = session.state === "banned" ? session.until : null;

  const end = until
    ? new Date(until).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      })
    : null;

  return (
    <main className="animate-enter mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="eyebrow">account suspended</p>

      <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-hi">
        This account has been stopped
      </h1>

      <p className="mt-3 text-[13.5px] leading-relaxed text-mid">
        {end
          ? `Access is paused until ${end} UTC.`
          : "Access is paused until an operator lifts it."}{" "}
        Runs in progress were cancelled; your chats and files are still there.
      </p>

      {reason ? (
        <p className="mt-5 rounded-2xl border border-line bg-card px-4 py-3 text-[13px] leading-relaxed text-mid">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-low">
            reason
          </span>
          <span className="mt-1 block text-hi">{reason}</span>
        </p>
      ) : null}

      <p className="mt-6 text-[12.5px] leading-relaxed text-low">
        If you think this is a mistake, reply to the address you signed up with.
      </p>

      <Link
        href="/privacy"
        className="mt-6 text-[12px] text-low underline decoration-line-strong underline-offset-4 hover:text-mid"
      >
        Privacy
      </Link>
    </main>
  );
}
