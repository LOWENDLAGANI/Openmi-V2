import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Account suspended — Openmi",
  robots: { index: false, follow: false },
};

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
    <main
      data-consent-scope="none"
      className="animate-enter mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6"
    >
      <div className="panel p-6">
        <p className="text-[12px] font-medium text-danger">Account suspended</p>

        <h1 className="mt-1.5 text-[22px] font-semibold tracking-[-0.025em] text-hi">
          This account has been stopped
        </h1>

        <p className="mt-3 text-[13.5px] leading-relaxed text-mid">
          {end
            ? `Access is paused until ${end} UTC.`
            : "Access is paused until an operator lifts it."}{" "}
          Runs in progress were cancelled; your chats and files are still
          preserved.
        </p>

        {reason ? (
          <div className="mt-4 rounded-lg border border-line bg-raised px-3.5 py-2.5 text-[13px] leading-relaxed text-mid">
            <span className="text-[11px] font-medium text-low">Reason</span>
            <span className="mt-1 block text-hi">{reason}</span>
          </div>
        ) : null}

        <p className="mt-5 text-[12.5px] leading-relaxed text-low">
          If you think this is a mistake, reply to the address you signed up
          with.
        </p>

        <Link
          href="/privacy"
          className="mt-4 inline-block text-[12.5px] font-medium text-accent-text underline-offset-4 hover:underline"
        >
          Privacy policy
        </Link>
      </div>
    </main>
  );
}
