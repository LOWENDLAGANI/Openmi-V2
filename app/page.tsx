import Link from "next/link";
import { redirect } from "next/navigation";

import { Beam } from "@/components/Beam";
import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { DAILY_FREE_CREDIT, CREDIT_PER_HOUR } from "@/lib/credits";
import { getSession } from "@/lib/session";
import { supportMailto } from "@/lib/support";

// The landing page reads the session to send a signed-in reader to /chat, so it
// must be evaluated per request even on a deployment with no Supabase keys.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Openmi — the repo agent that shows its work",
  description:
    "Connect GitHub, pick a repository, and work with a model that reads the code at a pinned commit and proposes edits as a reviewable diff. A change lands on its own branch, and every run reports only the exit code it observed.",
};

/**
 * The whole pitch is one card, centred in the viewport, on a page that does not
 * scroll: the claim, one call to action, and the way to the rest of the site.
 *
 * Everything that used to be a section below the fold is reachable from the
 * card's footer links, and every number is still imported from the module that
 * implements it so a price change cannot leave a stale figure here.
 */

const LINKS = [
  { href: "/pay", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
];

export default async function HomePage() {
  // A signed-in reader does not need the pitch; the workspace is where they
  // were going, and the landing page is the front door for everyone else.
  const session = await getSession();
  if (session.state === "signed-in") redirect("/chat");

  return (
    <main className="flex h-dvh w-full items-center justify-center overflow-hidden px-4 py-6 sm:px-6">
      <div className="w-full max-w-xl min-w-0">
        <Beam>
          <div className="rounded-3xl border border-line bg-card p-5 shadow-[var(--card-shadow)] sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <Link href="/" aria-label="Openmi home" className="shrink-0">
                <Brand />
              </Link>
              <ThemeSwitcher variant="icon" />
            </div>

            <h1 className="mt-7 max-w-[16ch] text-balance text-[clamp(2rem,5.2vw,3rem)] font-semibold leading-[0.98] tracking-[-0.03em] text-hi" style={{ fontFamily: "var(--font-display)" }}>
              Point it at a repo. Get a diff you can merge.
            </h1>

            <p className="mt-4 max-w-[46ch] text-pretty text-[14px] leading-[1.6] text-mid">
              Openmi reads your code at a pinned commit, cites the file and line
              it used, and proposes the change as a pull request on its own
              branch.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href="/login"
                className="btn btn-primary lift px-5 py-2.5 text-[13.5px]"
              >
                Start with GitHub
              </Link>
              <Link
                href="/pay"
                className="text-[13px] text-mid underline decoration-line-strong underline-offset-4 transition-colors hover:text-hi hover:decoration-current"
              >
                See plans and prices
              </Link>
            </div>

            <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4 text-[12px]">
              <div className="flex items-baseline gap-2">
                <dt className="text-low">Hour of work</dt>
                <dd className="font-medium tabular-nums text-hi">
                  {CREDIT_PER_HOUR} Credit
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-low">Free every day</dt>
                <dd className="font-medium tabular-nums text-hi">
                  {DAILY_FREE_CREDIT} Credit
                </dd>
              </div>
            </dl>

            <nav
              aria-label="Site"
              className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[12px]"
            >
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-mid transition-colors hover:text-hi"
                >
                  {link.label}
                </Link>
              ))}
              <a
                href={supportMailto("Support")}
                className="text-mid transition-colors hover:text-hi"
              >
                Support
              </a>
              <span className="ml-auto text-[11.5px] tabular-nums text-low">
                GitHub sign-in, no card
              </span>
            </nav>
          </div>
        </Beam>
      </div>
    </main>
  );
}
