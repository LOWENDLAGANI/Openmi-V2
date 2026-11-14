import Link from "next/link";
import { redirect } from "next/navigation";

import { Beam } from "@/components/Beam";
import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  DAILY_FREE_DEW,
  DEW_PER_HOUR,
  PAID_DAILY_FREE_DEW,
} from "@/lib/dew";
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
 * The steps, the safety claims and the example turn are the whole page.
 *
 * Every number on this page is imported from the module that implements it, so
 * a price change cannot leave a stale figure in the pitch. The example turn is
 * labelled as an example: it shows the shape of a real transcript without
 * pretending a recording exists.
 */

const STEPS = [
  {
    title: "Connect one repository.",
    body: "Sign in with GitHub or paste a personal access token. The chat is pinned to one commit, so every answer is about the code you chose.",
  },
  {
    title: "Give it one goal.",
    body: "Build it, fix the failing test, add the feature. Each command reports the exit code it observed, and a turn that could not run says so instead of guessing.",
  },
  {
    title: "Merge one diff.",
    body: "The change lands on its own branch as a pull request. Accept it, edit it, or close it. Nothing is force-pushed onto a branch you already touched.",
  },
];

const SAFETY = [
  {
    title: "Reads pinned to one commit",
    body: "The tree is fetched at a SHA, so a branch that moves mid-conversation cannot change what the model saw.",
  },
  {
    title: "GitHub token sealed at rest",
    body: "AES-256-GCM on the server, with the authentication tag checked on every read. The interface shows the last four characters.",
  },
  {
    title: "One branch per change",
    body: "A ready changeset is written to its own branch and opened as a pull request that you can reject or revert.",
  },
  {
    title: "No platform keys in the box",
    body: "The model key stays in the server process. The sandbox that runs your commands never receives it.",
  },
];

const TURN = [
  { command: "bun install --frozen-lockfile", state: "exit 0", ok: true },
  { command: "bun run build", state: "exit 2", ok: false },
  { command: "bun run build", state: "exit 0", ok: true },
];

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
            <Link
              href="/login"
              className="btn btn-primary lift group px-4 py-2 text-[12.5px]"
            >
              Get started
              <span
                aria-hidden="true"
                className="text-[13px] leading-none transition-transform duration-150 group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
          </div>
        </div>

        <nav
          aria-label="Sections"
          className="flex gap-5 overflow-x-auto border-t border-line px-5 py-2.5 text-[12.5px] md:hidden"
        >
          <a href="#how" className="whitespace-nowrap text-mid hover:text-hi">
            How it works
          </a>
          <a href="#security" className="whitespace-nowrap text-mid hover:text-hi">
            Security
          </a>
          <Link href="/pay" className="whitespace-nowrap text-mid hover:text-hi">
            Pricing
          </Link>
          <Link href="/about" className="whitespace-nowrap text-mid hover:text-hi">
            About
          </Link>
        </nav>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────────
          One claim, one call to action, and the product itself on the right.
          The decorative blur that used to sit behind the card is gone: it was
          the only element on the page not drawn from the token layer. */}
      <section className="border-b border-line">
        <div className="mx-auto grid w-full max-w-6xl gap-14 px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)] lg:items-center lg:gap-14">
          <div className="min-w-0">
            <h1 className="max-w-[15ch] text-balance text-[clamp(2.4rem,5.6vw,4rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-hi">
              Point it at a repo. Get a diff you can merge.
            </h1>

            <p className="mt-6 max-w-[46ch] text-pretty text-[15.5px] leading-[1.65] text-mid">
              Openmi reads your code at a pinned commit, cites the file and line
              it used, and proposes the change as a pull request on its own
              branch.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link
                href="/login"
                className="btn btn-primary lift group px-6 py-3 text-[14.5px]"
              >
                Start with GitHub
                <span
                  aria-hidden="true"
                  className="text-[15px] leading-none transition-transform duration-150 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
              <a
                href="#how"
                className="text-[13.5px] text-mid underline decoration-line-strong underline-offset-4 transition-colors hover:text-hi hover:decoration-current"
              >
                See how a turn runs
              </a>
            </div>

            <dl className="mt-10 flex flex-wrap gap-x-8 gap-y-3 border-t border-line pt-5 text-[12.5px]">
              <div className="flex items-baseline gap-2">
                <dt className="text-low">Hour of work</dt>
                <dd className="font-medium tabular-nums text-hi">
                  {DEW_PER_HOUR} Dew
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-low">Free every day</dt>
                <dd className="font-medium tabular-nums text-hi">
                  {DAILY_FREE_DEW} Dew
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-low">On a paid plan</dt>
                <dd className="font-medium tabular-nums text-hi">
                  {PAID_DAILY_FREE_DEW} Dew
                </dd>
              </div>
            </dl>
          </div>

          {/* The actual shape of a turn: your message, the commands with the
              exit codes they returned, and the diff that came back. */}
          <figure className="min-w-0 lg:mt-2">
            <Beam>
              <div className="rounded-3xl border border-line bg-card p-3 shadow-[var(--card-shadow)]">
                <div className="rounded-xl bg-canvas p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-mono text-[11px] text-mid">
                      lowendlagani/openmi-v2
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-low">
                      9f2c1a
                    </span>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <p className="max-w-[85%] rounded-[18px] bg-bubble px-3.5 py-2 text-[13px] leading-snug text-bubble-text">
                      Install and build this, then fix what fails.
                    </p>
                  </div>

                  <ul className="mt-4 space-y-2">
                    {TURN.map((row, index) => (
                      <li
                        key={`${row.command}-${index}`}
                        className="flex items-baseline gap-2 border-t border-line pt-2 first:border-0 first:pt-0"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-body">
                          <span className="mr-1.5 text-low">$</span>
                          {row.command}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[11px] tabular-nums ${
                            row.ok ? "text-accent-text" : "text-danger"
                          }`}
                        >
                          {row.state}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-4 border-t border-line pt-3 text-pretty text-[13.5px] leading-relaxed text-body">
                    The build failed on a missing export in{" "}
                    <span className="rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[12px] text-accent-text">lib/agent/run.ts</span>. I added it and re-ran the same command.
                  </p>

                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
                    <span className="text-[12px] tabular-nums text-mid">
                      3 files changed · +18 −6
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-line-strong px-3 py-1 text-[11.5px] font-medium text-body">
                      Review diff
                      <span aria-hidden="true" className="leading-none">
                        →
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </Beam>

            <figcaption className="mt-3 px-1 text-[11.5px] text-low">
              An example turn. Exit codes and the diff are what the workspace
              reports; nothing here is a recording.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section id="how" className="border-b border-line">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <h2 className="max-w-[22ch] text-balance text-[clamp(1.75rem,3.6vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-hi">
            Three steps, one branch, no surprise pushes.
          </h2>
          <p className="mt-3 max-w-[58ch] text-pretty text-[14px] leading-relaxed text-mid">
            A repository, one goal, and a review. The workspace keeps the
            conversation next to the commits it is talking about.
          </p>

          <div className="mt-10 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <article
                key={step.title}
                className="group bg-canvas p-6 transition-colors duration-150 hover:bg-card sm:p-7"
              >
                <h3 className="text-[16.5px] font-semibold leading-snug tracking-[-0.025em] text-hi">
                  <span className="mr-2 text-[13px] font-normal tabular-nums text-low">
                    {index + 1}.
                  </span>
                  {step.title}
                </h3>
                <p className="mt-2.5 text-pretty text-[13px] leading-relaxed text-mid">
                  {step.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Security ──────────────────────────────────────────────────────── */}
      <section id="security" className="border-b border-line bg-raised">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
            <div>
              <h2 className="max-w-[18ch] text-balance text-[clamp(1.75rem,3.4vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.035em] text-hi">
                The sandbox holds no keys and cannot push.
              </h2>
              <p className="mt-4 max-w-[42ch] text-pretty text-[13.5px] leading-relaxed text-mid">
                The model can run commands and read the tree it was pinned to.
                Everything that changes your repository happens on the server,
                through a branch and a pull request.
              </p>
            </div>

            <ul className="grid gap-3 sm:grid-cols-2">
              {SAFETY.map((item) => (
                <li
                  key={item.title}
                  className="rounded-2xl border border-line bg-card p-5 transition-colors duration-150 hover:border-line-strong"
                >
                  <h3 className="text-[13.5px] font-semibold tracking-[-0.02em] text-hi">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-pretty text-[12px] leading-relaxed text-mid">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-8 max-w-2xl border-t border-line pt-4 text-pretty text-[11.5px] leading-relaxed text-mid">
            Execution is deployment-dependent. A chat turn reads GitHub only
            unless sandbox turns are enabled, and verification runs need an
            execution key. Without one, the interface says a command did not run
            instead of implying it did.
          </p>
        </div>
      </section>

      {/* ── Price ─────────────────────────────────────────────────────────── */}
      <section className="border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-14 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-balance text-[clamp(1.5rem,3vw,2.1rem)] font-semibold leading-[1.12] tracking-[-0.03em] text-hi">
              <span className="tabular-nums">{DEW_PER_HOUR} Dew</span> an hour.{" "}
              <span className="tabular-nums">{DAILY_FREE_DEW} free</span> every
              day.
            </h2>
            <p className="mt-2 max-w-[52ch] text-pretty text-[13px] leading-relaxed text-mid">
              An hour is charged once before the provider call, and the rest of
              that hour is free. A paid plan raises the daily allowance to{" "}
              <span className="tabular-nums">{PAID_DAILY_FREE_DEW} Dew</span>.
            </p>
          </div>

          <Link
            href="/pay"
            className="btn lift shrink-0 self-start px-5 py-2.5 text-[13px] md:self-auto"
          >
            See plans and prices
          </Link>
        </div>
      </section>

      {/* ── Closing call to action ────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
        <div className="rounded-3xl border border-line bg-card px-6 py-12 text-center sm:px-10 sm:py-14">
          <h2 className="mx-auto max-w-[20ch] text-balance text-[clamp(1.6rem,3.6vw,2.4rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-hi">
            Bring a repository. Leave with a pull request.
          </h2>
          <p className="mx-auto mt-3 max-w-[44ch] text-pretty text-[13.5px] leading-relaxed text-mid">
            GitHub sign-in is the whole setup. The free allowance resets daily
            and needs no card.
          </p>
          <Link
            href="/login"
            className="btn btn-primary lift group mt-7 px-6 py-3 text-[14px]"
          >
            Start with GitHub
            <span
              aria-hidden="true"
              className="text-[15px] leading-none transition-transform duration-150 group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-8 px-5 py-10 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] sm:px-8">
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
            <Link href="/privacy#cookies" className="block text-mid hover:text-hi">
              Cookies
            </Link>
            <a href={supportMailto("Support")} className="block text-mid hover:text-hi">
              Support
            </a>
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
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-5 text-[11.5px] text-low sm:px-8">
            <p>
              © 2026 Openmi ·{" "}
              <Link href="/terms" className="hover:text-hi">
                Terms
              </Link>{" "}
              ·{" "}
              <Link href="/privacy" className="hover:text-hi">
                Privacy
              </Link>
            </p>
            <p>GitHub sign-in · no card on file</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
