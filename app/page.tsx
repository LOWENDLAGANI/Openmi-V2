import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { OpenmiMark } from "@/components/OpenmiMark";
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
 *
 * The layout is one centred column on a single blue field — mark, claim, one
 * line of context, one box to type into, three ways to start — and the proof
 * sits underneath it. The page is its own surface (`landing-sky` in
 * globals.css), so the blue is the design, not a theme: the sections below
 * inherit it through the same semantic tokens every other screen uses.
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

/** The three ways in, shown as the first thing a reader can click. */
const STARTERS = [
  "Explain this repo",
  "Fix a failing build",
  "Review my changes",
];

export default async function HomePage() {
  // A signed-in reader does not need the pitch; the workspace is where they
  // were going, and the landing page is the front door for everyone else.
  const session = await getSession();
  if (session.state === "signed-in") redirect("/chat");

  return (
    <main className="landing-sky min-h-dvh animate-enter bg-canvas text-body">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
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
            <Link
              href="/login"
              className="btn btn-primary lift px-5 py-2 text-[13px]"
            >
              Start free
            </Link>
          </div>
        </div>

        <nav
          aria-label="Sections"
          className="flex gap-5 overflow-x-auto border-t border-line px-5 py-2.5 text-[12.5px] md:hidden"
        >
          <a href="#how" className="whitespace-nowrap text-body hover:text-hi">
            How it works
          </a>
          <a href="#security" className="whitespace-nowrap text-body hover:text-hi">
            Security
          </a>
          <Link href="/pay" className="whitespace-nowrap text-body hover:text-hi">
            Pricing
          </Link>
          <Link href="/about" className="whitespace-nowrap text-body hover:text-hi">
            About
          </Link>
        </nav>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────────
          One mark, one claim, one line of context, one box to type into. The
          mark sits above the headline the way the reference does it: a small
          object you could almost pick up, then the sentence that says what the
          product is. */}
      <section className="border-b border-line">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 pb-14 pt-12 text-center sm:pt-16">
          <span className="grid size-16 place-items-center rounded-[22px] bg-card shadow-[var(--card-shadow)]">
            <OpenmiMark size={34} />
          </span>

          <h1 className="mt-7 max-w-[18ch] text-balance text-[clamp(2.5rem,7.4vw,4.3rem)] font-semibold leading-[0.98] tracking-[-0.05em] text-hi">
            Point it at a repo. Get a diff you can merge.
          </h1>

          <p className="mt-5 max-w-[44ch] text-pretty text-[15.5px] leading-[1.6] text-body">
            Meet the agent that reads your code at a pinned commit and proposes
            the change as a pull request on its own branch.
          </p>

          {/* The box is the first control, not a decoration: typing and pressing
              Enter goes to sign-in, which is the whole setup. It is a plain
              form, so it works before any JavaScript has run. */}
          <form
            action="/login"
            method="get"
            className="mt-8 w-full max-w-[34rem]"
          >
            <div className="relative rounded-[28px] bg-card p-2.5 text-left shadow-[0_22px_50px_rgba(9,38,76,0.22)] ring-1 ring-line">
              <label htmlFor="ask" className="sr-only">
                Ask Openmi what to do
              </label>
              <input
                id="ask"
                name="ask"
                type="text"
                autoComplete="off"
                placeholder="Ask Openmi to build, fix or explain…"
                className="w-full bg-transparent px-4 pb-12 pt-3 text-[15px] text-hi placeholder:text-low focus-visible:outline-none"
              />
              <button
                type="submit"
                aria-label="Ask Openmi"
                className="absolute bottom-3 right-3 grid size-11 place-items-center rounded-full bg-accent text-on-accent transition-transform duration-150 hover:scale-105"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-[18px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V5" />
                  <path d="m5 12 7-7 7 7" />
                </svg>
              </button>
            </div>
          </form>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {STARTERS.map((starter) => (
              <Link
                key={starter}
                href="/login"
                className="rounded-full bg-chip px-4 py-2 text-[13px] text-body ring-1 ring-line transition-colors duration-150 hover:bg-card hover:text-hi"
              >
                {starter}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── The shape of a turn ────────────────────────────────────────────── */}
      <section className="border-b border-line">
        <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:py-16">
          <figure className="min-w-0">
            <div className="rounded-3xl bg-card p-3 shadow-[0_26px_60px_rgba(9,38,76,0.2)]">
              <div className="rounded-2xl bg-canvas p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-[11px] text-body">
                    lowendlagani/openmi-v2
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-mid">
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
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-hi">
                        <span className="mr-1.5 text-mid">$</span>
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

                <p className="mt-4 border-t border-line pt-3 text-pretty text-[13.5px] leading-relaxed text-hi">
                  The build failed on a missing export in{" "}
                  <span className="rounded-full bg-accent-soft px-1.5 py-0.5 font-mono text-[12px] text-accent-text">
                    lib/agent/run.ts
                  </span>
                  . I added it and re-ran the same command.
                </p>

                <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
                  <span className="text-[12px] tabular-nums text-body">
                    3 files changed · +18 −6
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-line-strong px-3 py-1 text-[11.5px] font-medium text-hi">
                    Review diff
                    <span aria-hidden="true" className="leading-none">
                      →
                    </span>
                  </span>
                </div>
              </div>
            </div>

            <figcaption className="mt-3 px-1 text-center text-[11.5px] text-body">
              An example turn. Exit codes and the diff are what the workspace
              reports; nothing here is a recording.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section id="how" className="border-b border-line">
        <div className="mx-auto w-full max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
          <h2 className="mx-auto max-w-[24ch] text-balance text-center text-[clamp(1.9rem,4.2vw,2.9rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-hi">
            Three steps, one branch, no surprise pushes.
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-center text-pretty text-[14px] leading-relaxed text-body">
            A repository, one goal, and a review. The workspace keeps the
            conversation next to the commits it is talking about.
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <article
                key={step.title}
                className="rounded-3xl bg-card p-6 shadow-[0_14px_34px_rgba(9,38,76,0.14)] transition-transform duration-200 hover:-translate-y-0.5 sm:p-7"
              >
                <span className="font-mono text-[11px] tabular-nums text-mid">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.025em] text-hi">
                  {step.title}
                </h3>
                <p className="mt-2.5 text-pretty text-[13px] leading-relaxed text-body">
                  {step.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Security ──────────────────────────────────────────────────────── */}
      <section id="security" className="border-b border-line">
        <div className="mx-auto w-full max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
          <h2 className="mx-auto max-w-[20ch] text-balance text-center text-[clamp(1.9rem,4vw,2.8rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-hi">
            The sandbox holds no keys and cannot push.
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-center text-pretty text-[13.5px] leading-relaxed text-body">
            The model can run commands and read the tree it was pinned to.
            Everything that changes your repository happens on the server,
            through a branch and a pull request.
          </p>

          <ul className="mt-10 grid gap-3 sm:grid-cols-2">
            {SAFETY.map((item) => (
              <li
                key={item.title}
                className="rounded-2xl bg-card p-5 shadow-[0_12px_30px_rgba(9,38,76,0.12)]"
              >
                <h3 className="text-[13.5px] font-semibold tracking-[-0.02em] text-hi">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-pretty text-[12px] leading-relaxed text-body">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>

          <p className="mx-auto mt-8 max-w-2xl border-t border-line pt-4 text-center text-pretty text-[11.5px] leading-relaxed text-body">
            Execution is deployment-dependent. A chat turn reads GitHub only
            unless sandbox turns are enabled, and verification runs need an
            execution key. Without one, the interface says a command did not run
            instead of implying it did.
          </p>
        </div>
      </section>

      {/* ── Price ─────────────────────────────────────────────────────────── */}
      <section className="border-b border-line">
        <div className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8">
          <div className="flex flex-col gap-6 rounded-3xl bg-card p-7 shadow-[0_14px_34px_rgba(9,38,76,0.14)] md:flex-row md:items-center md:justify-between sm:p-9">
            <div>
              <h2 className="text-balance text-[clamp(1.5rem,3vw,2.1rem)] font-semibold leading-[1.12] tracking-[-0.03em] text-hi">
                <span className="tabular-nums">{DEW_PER_HOUR} Dew</span> an hour.{" "}
                <span className="tabular-nums">{DAILY_FREE_DEW} free</span> every
                day.
              </h2>
              <p className="mt-2 max-w-[52ch] text-pretty text-[13px] leading-relaxed text-body">
                An hour is charged once before the provider call, and the rest of
                that hour is free. A paid plan raises the daily allowance to{" "}
                <span className="tabular-nums">{PAID_DAILY_FREE_DEW} Dew</span>.
              </p>
            </div>

            <Link
              href="/pay"
              className="btn btn-primary lift shrink-0 self-start px-5 py-2.5 text-[13px] md:self-auto"
            >
              See plans and prices
            </Link>
          </div>
        </div>
      </section>

      {/* ── Closing call to action ────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-3xl px-5 py-20 sm:px-8">
        <div className="rounded-[32px] bg-card px-6 py-12 text-center shadow-[0_26px_60px_rgba(9,38,76,0.2)] sm:px-10 sm:py-14">
          <h2 className="mx-auto max-w-[20ch] text-balance text-[clamp(1.8rem,4vw,2.6rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-hi">
            Bring a repository. Leave with a pull request.
          </h2>
          <p className="mx-auto mt-3 max-w-[44ch] text-pretty text-[13.5px] leading-relaxed text-body">
            GitHub sign-in is the whole setup. The free allowance resets daily
            and needs no card.
          </p>
          <Link
            href="/login"
            className="btn btn-primary lift group mt-7 px-6 py-3 text-[14px]"
          >
            Start free
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
            <Link href="/pay" className="block text-body hover:text-hi">
              Pricing
            </Link>
            <Link href="/about" className="block text-body hover:text-hi">
              About
            </Link>
            <Link href="/terms" className="block text-body hover:text-hi">
              Terms
            </Link>
            <Link href="/privacy" className="block text-body hover:text-hi">
              Privacy
            </Link>
            <Link href="/refunds" className="block text-body hover:text-hi">
              Refunds
            </Link>
            <Link href="/privacy#cookies" className="block text-body hover:text-hi">
              Cookies
            </Link>
            <a href={supportMailto("Support")} className="block text-body hover:text-hi">
              Support
            </a>
          </nav>

          <nav aria-label="Account" className="space-y-2 text-[12.5px]">
            <p className="eyebrow">account</p>
            <Link href="/login" className="block text-body hover:text-hi">
              Sign in
            </Link>
            <Link href="/login" className="block text-body hover:text-hi">
              Create account
            </Link>
            <a href="#how" className="block text-body hover:text-hi">
              How it works
            </a>
            <Link href="/account/delete" className="block text-body hover:text-hi">
              Delete account
            </Link>
          </nav>
        </div>

        <div className="border-t border-line">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-5 text-[11.5px] text-mid sm:px-8">
            <p>
              © 2026 Openmi ·{" "}
              <Link href="/terms" className="hover:text-hi">
                Terms
              </Link>{" "}
              ·{" "}
              <Link href="/privacy" className="hover:text-hi">
                Privacy
              </Link>{" "}
              ·{" "}
              <Link href="/refunds" className="hover:text-hi">
                Refunds
              </Link>
            </p>
            <p>GitHub sign-in · no card on file</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
