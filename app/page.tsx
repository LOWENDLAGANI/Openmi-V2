import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { DAILY_FREE_DEW, DEW_PER_HOUR } from "@/lib/dew";
import { getSession } from "@/lib/session";

// The landing page reads the session to send a signed-in reader to /chat, so it
// must be evaluated per request even on a deployment with no Supabase keys.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Openmi — the repo agent that shows its work",
  description:
    "Connect GitHub, pick a repository, and work with a model that reads the code at a pinned commit and proposes edits as a reviewable diff. A change lands on its own branch, and every run reports only the exit code it observed.",
};

const STEPS = ["Pick a repository", "Give it a goal", "Review the diff"];

const SECURITY = [
  "Reads pinned to one commit",
  "GitHub token sealed on the server",
  "One branch per changeset, never a forced update",
  "No platform keys inside the sandbox",
];

const SESSION = [
  { purpose: "install dependencies", command: "bun install --frozen-lockfile", code: 0 },
  { purpose: "typecheck the project", command: "bun run typecheck", code: 0 },
  { purpose: "run the failing test", command: "bun test tests/mission.test.ts", code: 0 },
  { purpose: "collect the diff", command: "git diff --stat", code: null },
] as const;

export default async function HomePage() {
  // A signed-in reader does not need the pitch; the workspace is where they
  // were going, and the landing page is the front door for everyone else.
  const session = await getSession();
  if (session.state === "signed-in") redirect("/chat");

  return (
    <main className="min-h-dvh animate-enter">
      <header className="glass sticky top-0 z-40 border-b border-line">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-5 sm:px-8">
          <Link href="/" aria-label="Openmi home" className="shrink-0">
            <Brand />
          </Link>

          <nav aria-label="Sections" className="ml-8 hidden items-center gap-1 md:flex">
            <a href="#how" className="btn btn-quiet px-3 py-1.5 text-[13px]">
              How it works
            </a>
            <a href="#security" className="btn btn-quiet px-3 py-1.5 text-[13px]">
              Security
            </a>
            <Link href="/pay" className="btn btn-quiet px-3 py-1.5 text-[13px]">
              Pricing
            </Link>
            <Link href="/about" className="btn btn-quiet px-3 py-1.5 text-[13px]">
              About
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link href="/login" className="btn btn-primary px-4 py-2 text-[12.5px]">
              Get started
              <span aria-hidden="true" className="text-[13px] leading-none">
                →
              </span>
            </Link>
          </div>
        </div>

        <nav
          aria-label="Sections"
          className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden"
        >
          <a href="#how" className="quick-chip text-[11.5px]">
            How it works
          </a>
          <a href="#security" className="quick-chip text-[11.5px]">
            Security
          </a>
          <Link href="/pay" className="quick-chip text-[11.5px]">
            Pricing
          </Link>
          <Link href="/about" className="quick-chip text-[11.5px]">
            About
          </Link>
        </nav>
      </header>

      <section className="border-b border-line">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-16">
          <div>
            <p className="eyebrow flex items-center gap-2 text-accent-text">
              <span aria-hidden="true" className="marker" />
              repo agent
            </p>

            <h1 className="mt-6 text-[clamp(2.5rem,6.4vw,4.35rem)] font-semibold leading-[1.01] tracking-[-0.045em] text-hi">
              Give it a goal.
              <span className="block text-mid">Watch it work.</span>
              <span className="block">Ship the diff.</span>
            </h1>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login" className="btn btn-primary px-5 py-2.5 text-[13.5px]">
                Start with GitHub
                <span aria-hidden="true" className="text-[13px] leading-none">
                  →
                </span>
              </Link>
              <a href="#how" className="btn px-5 py-2.5 text-[13.5px]">
                See how it works
              </a>
            </div>

            <p className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-low">
              {DEW_PER_HOUR} dew an hour · {DAILY_FREE_DEW} free every day
            </p>
          </div>

          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute -inset-6 rounded-[40px] bg-accent-soft blur-2xl"
            />

            <div className="relative overflow-hidden rounded-3xl border border-line bg-card shadow-[0_36px_90px_-48px_rgba(20,18,13,0.55)]">
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-low">
                  mission · lowendlagani/openmi-v2
                </span>
                <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-accent-text">
                  sample
                </span>
              </div>

              <div className="space-y-1.5 px-3 py-3">
                {SESSION.map((row, index) => {
                  const running = row.code === null;

                  return (
                    <div
                      key={row.command}
                      className={`rounded-xl border px-3 py-2 ${
                        running
                          ? "border-accent/45 bg-accent-soft/35"
                          : "border-line bg-raised"
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-[9.5px] text-low">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-mid">
                          {row.purpose}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-accent-text">
                          {running ? "running" : `exit ${row.code}`}
                        </span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-body">
                        <span className="mr-1.5 text-low">$</span>
                        {row.command}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
                <span className="text-[11.5px] text-mid">4 files changed · diff ready</span>
                <span className="rounded-full border border-line-strong px-2.5 py-1 text-[11px] text-body">
                  Review diff
                </span>
              </div>
            </div>

          </div>
        </div>
      </section>

      <section id="how" className="border-b border-line">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <p className="eyebrow flex items-center gap-2 text-accent-text">
            <span aria-hidden="true" className="marker" />
            how it works
          </p>
          <h2 className="mt-4 max-w-2xl text-[clamp(1.75rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-hi">
            One conversation. A real machine. A diff you control.
          </h2>

          <div className="mt-10 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-3">
            {STEPS.map((title, index) => (
              <article key={title} className="bg-canvas p-6 sm:p-8">
                <p className="eyebrow text-accent-text">step {index + 1}</p>
                <h3 className="mt-3 text-[17px] font-semibold tracking-[-0.025em] text-hi">
                  {title}
                </h3>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="security" className="border-b border-line bg-raised">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <p className="eyebrow flex items-center gap-2 text-accent-text">
              <span aria-hidden="true" className="marker" />
              safety by construction
            </p>
            <h2 className="mt-4 text-[clamp(1.75rem,3.4vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-hi">
              An open shell with the doors still locked.
            </h2>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2">
            {SECURITY.map((title) => (
              <li key={title} className="rounded-2xl border border-line bg-card p-5">
                <h3 className="text-[13.5px] font-semibold tracking-[-0.02em] text-hi">
                  {title}
                </h3>
              </li>
            ))}
          </ul>

          <p className="mt-4 max-w-xl text-[11px] leading-relaxed text-low">
            Execution is deployment-dependent. A chat turn reads GitHub only
            unless sandbox turns are enabled, and verification runs and missions
            need an execution key. Without one the interface says a command did
            not run instead of implying it did.
          </p>
        </div>
      </section>

      <section className="border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-14 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="eyebrow flex items-center gap-2 text-accent-text">
              <span aria-hidden="true" className="marker" />
              pricing
            </p>
            <h2 className="mt-3 text-[clamp(1.5rem,3vw,2.1rem)] font-semibold leading-[1.12] tracking-[-0.03em] text-hi">
              {DEW_PER_HOUR} Dew an hour. {DAILY_FREE_DEW} free every day.
            </h2>
          </div>

          <Link href="/pay" className="btn shrink-0 px-5 py-2.5 text-[13px]">
            See plans
          </Link>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <div className="rounded-3xl border border-line bg-card px-6 py-10 text-center shadow-[0_30px_70px_-52px_rgba(20,18,13,0.5)] sm:px-10 sm:py-14">
          <h2 className="mx-auto max-w-xl text-[clamp(1.6rem,3.6vw,2.4rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-hi">
            Bring a repository. Leave with a pull request.
          </h2>
          <Link
            href="/login"
            className="btn btn-primary mt-7 px-6 py-2.5 text-[13.5px]"
          >
            Start building
            <span aria-hidden="true" className="text-[13px] leading-none">
              →
            </span>
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-8 px-5 py-10 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:px-8">
          <div className="col-span-2 sm:col-span-1">
            <Brand />
          </div>

          <nav aria-label="Product" className="space-y-2 text-[12.5px]">
            <p className="eyebrow">product</p>
            <Link href="/pay" className="block text-mid hover:text-hi">
              Pricing
            </Link>
            <Link href="/about" className="block text-mid hover:text-hi">
              About
            </Link>
            <Link href="/terms" className="block text-mid hover:text-hi">
              Terms
            </Link>
            <Link href="/privacy" className="block text-mid hover:text-hi">
              Privacy
            </Link>
          </nav>

          <nav aria-label="Account" className="space-y-2 text-[12.5px]">
            <p className="eyebrow">account</p>
            <Link href="/login" className="block text-mid hover:text-hi">
              Sign in
            </Link>
            <Link href="/login" className="block text-mid hover:text-hi">
              Create account
            </Link>
            <a href="#how" className="block text-mid hover:text-hi">
              How it works
            </a>
          </nav>
        </div>

        <div className="border-t border-line">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-5 sm:px-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-low">
              © 2026 Openmi ·{" "}
              <Link href="/terms" className="hover:text-hi">
                Terms
              </Link>{" "}
              ·{" "}
              <Link href="/privacy" className="hover:text-hi">
                Privacy
              </Link>
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-low">
              built for GitHub
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
