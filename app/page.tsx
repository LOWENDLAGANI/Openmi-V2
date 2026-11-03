import Link from "next/link";
import { AdBanner } from "@/components/AdBanner";
import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

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

export default function HomePage() {
  return (
    <main className="min-h-dvh animate-enter">
      <header className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8">
        <Brand />
        <nav className="flex flex-wrap items-center justify-end gap-1.5">
          <ThemeSwitcher />
          <Link href="/about" className="btn btn-quiet px-3 py-1.5 text-[12.5px]">
            About
          </Link>
          <Link href="/setup" className="btn px-3.5 py-1.5 text-[12.5px]">
            Setup status
          </Link>
          <Link href="/login" className="btn btn-primary px-4 py-1.5 text-[12.5px]">
            Sign in
          </Link>
        </nav>
      </header>

      <div className="border-y border-line bg-raised">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-5 py-2.5 sm:px-8">
          <span className="eyebrow flex items-center gap-2 text-accent-text">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
            openmi
          </span>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-mid">
            reads the repository · proposes a diff · opens one pull request
          </p>
          <Link
            href="/about"
            className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-accent-text hover:underline"
          >
            read more ›
          </Link>
        </div>
      </div>

      <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-20">
        <p className="eyebrow">phase 0 · foundation</p>

        <h1 className="mt-6 text-[clamp(2.3rem,7.4vw,4.7rem)] font-semibold leading-[1.03] tracking-[-0.04em]">
          <span className="block text-hi">Every file read.</span>
          <span className="block text-low">Every diff reviewed.</span>
          <span className="block text-low">Every push approved.</span>
        </h1>

        <div className="mt-10 grid gap-8 sm:mt-14 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <p className="max-w-md text-[15px] leading-relaxed text-mid">
            Chat with your repository. Review the diff. Approve the pull request
            <span aria-hidden="true" className="mx-1 inline-block size-2.5 translate-y-[-1px] bg-accent" />
            or don&apos;t.
          </p>

          <div className="flex flex-wrap gap-2">
            <Link href="/login" className="btn btn-primary px-5 py-2.5 text-[13px]">
              Sign in to start
            </Link>
            <Link href="/setup" className="btn px-5 py-2.5 text-[13px]">
              Check configuration
            </Link>
          </div>
        </div>
      </section>

      <AdBanner className="mx-auto w-full max-w-6xl px-5 pb-14 sm:px-8" />

      <section className="border-t border-line">
        <div className="mx-auto grid w-full max-w-6xl gap-px bg-line sm:grid-cols-3">
          {CAPABILITIES.map((item, index) => (
            <article key={item.title} className="bg-canvas px-5 py-9 sm:px-8 sm:py-11">
              <p className="eyebrow text-accent-text">
                0{index + 1} · {item.tag}
              </p>
              <h2 className="mt-3 text-[17px] font-semibold leading-snug tracking-[-0.02em] text-hi">
                {item.title}
              </h2>
              <p className="mt-2.5 text-[13px] leading-relaxed text-mid">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 sm:px-8">
        <p className="eyebrow">
          every phase is written down in OPENMI_BUILD_PHASES.md
        </p>
        <p className="eyebrow">no build · no test · no merge</p>
      </footer>
    </main>
  );
}
