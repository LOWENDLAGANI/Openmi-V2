import Link from "next/link";
import { redirect } from "next/navigation";

import { AdBanner } from "@/components/AdBanner";
import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { getSession } from "@/lib/session";

// The landing page reads the session to send a signed-in reader to /chat, so it
// must be evaluated per request even on a deployment with no Supabase keys.
export const dynamic = "force-dynamic";

const CAPABILITIES = [
  {
    title: "Reads the repository",
    body: "Pick a repository and a commit. The agent browses the tree, reads files and searches code, and every answer cites the path and line it came from.",
    tag: "P2 · P4",
  },
  {
    title: "Proposes, never pushes",
    body: "Edits arrive as a reviewable diff, one file at a time. Nothing leaves the browser until you accept the change and press approve.",
    tag: "P5",
  },
  {
    title: "Opens a branch and a pull request",
    body: "Approval creates a branch and opens a pull request against the base you chose. The default branch is refused in code, not by convention.",
    tag: "P6",
  },
];

export default async function HomePage() {
  // A signed-in reader does not need the pitch; the workspace is where they
  // were going, and the landing page is the front door for everyone else.
  const session = await getSession();
  if (session.state === "signed-in") redirect("/chat");

  return (
    <main className="min-h-dvh animate-enter">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Brand />
        <nav className="flex flex-wrap items-center justify-end gap-1.5">
          <ThemeSwitcher />
          <Link href="/about" className="btn btn-quiet px-3 py-1.5 text-[12.5px]">
            About
          </Link>
          <Link href="/login" className="btn btn-primary px-4 py-1.5 text-[12.5px]">
            Sign in
            <span aria-hidden="true" className="text-[13px] leading-none">
              →
            </span>
          </Link>
        </nav>
      </header>

      <div className="border-y border-line bg-raised">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-2.5 sm:px-8">
          <span className="eyebrow flex items-center gap-2 text-accent-text">
            <span aria-hidden="true" className="marker" />
            repo agent
          </span>

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-mid">
            <span>read the repository</span>
            <span aria-hidden="true" className="marker" />
            <span>stage the diff</span>
            <span aria-hidden="true" className="marker" />
            <span>approve</span>
          </p>

          <Link
            href="/about"
            className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-accent-text hover:underline"
          >
            read more ›
          </Link>
        </div>
      </div>

      <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-20">
        <p className="eyebrow flex items-center gap-2 text-accent-text">
          <span aria-hidden="true" className="marker" />
          phase 0 · foundation
        </p>

        <h1 className="mt-7 max-w-[19ch] text-[clamp(2.4rem,7.6vw,4.9rem)] font-semibold leading-[0.97] tracking-[-0.05em] text-hi">
          Every file read.
          <span className="mt-1 block text-mid">Every diff reviewed.</span>
          <span className="block text-mid">Every push approved.</span>
        </h1>

        <div className="mt-11 grid gap-8 border-t border-line pt-8 sm:mt-16 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <p className="max-w-md text-[15.5px] leading-[1.7] text-mid">
            Chat with your repository. Review the diff. Approve the pull request
            <span
              aria-hidden="true"
              className="mx-1.5 inline-block size-2 translate-y-[-2px] bg-accent"
            />
            or don&apos;t.
          </p>

          <div className="flex flex-wrap gap-2">
            <Link href="/login" className="btn btn-primary px-5 py-2.5 text-[13px]">
              Sign in to start
              <span aria-hidden="true" className="text-[13px] leading-none">
                →
              </span>
            </Link>
            <Link href="/about" className="btn px-5 py-2.5 text-[13px]">
              See what shipped
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
          <p className="max-w-2xl font-mono text-[11.5px] uppercase leading-[2] tracking-[0.15em] text-mid">
            Building the repo agent that shows you the diff before it writes one.
          </p>
          <Link
            href="/about"
            className="mt-6 inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-accent-text hover:underline"
          >
            read more
            <span aria-hidden="true">›</span>
          </Link>
        </div>
      </section>

      <AdBanner className="mx-auto w-full max-w-6xl px-5 pb-14 sm:px-8" />

      <section className="border-t border-line">
        <div className="mx-auto grid w-full max-w-6xl gap-px bg-line sm:grid-cols-3">
          {CAPABILITIES.map((item, index) => (
            <article key={item.title} className="bg-canvas px-5 py-9 sm:px-8 sm:py-11">
              <p className="eyebrow flex items-center gap-2 text-accent-text">
                <span aria-hidden="true" className="marker" />
                0{index + 1} · {item.tag}
              </p>
              <h2 className="mt-4 text-[18px] font-semibold leading-snug tracking-[-0.03em] text-hi">
                {item.title}
              </h2>
              <p className="mt-2.5 text-[13px] leading-relaxed text-mid">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 sm:px-8">
          <p className="eyebrow">
            every phase is written down in OPENMI_BUILD_PHASES.md
          </p>
          <p className="eyebrow">no build · no test · no merge</p>
        </div>
      </footer>
    </main>
  );
}
