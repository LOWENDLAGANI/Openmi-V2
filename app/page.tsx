import Link from "next/link";
import { Brand } from "@/components/Brand";

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
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <Brand />
        <Link
          href="/setup"
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-body transition-colors hover:bg-hover"
        >
          Setup status
        </Link>
      </header>

      <section className="mt-20 max-w-2xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-low">
          Phase 0 · foundation
        </p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.1] tracking-tight text-hi sm:text-5xl">
          Your repository,
          <br />
          with a reviewer built in.
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-mid">
          Openmi is a chat client welded to a GitHub repository. It reads the
          code, proposes edits as a diff, and opens a pull request only after
          you approve one. It never runs your tests, and it says so.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/setup"
            className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent transition-opacity hover:opacity-90"
          >
            Check configuration
          </Link>
          <Link
            href="/about"
            className="rounded-lg border border-line bg-card px-4 py-2 text-[13px] font-medium text-body transition-colors hover:bg-hover"
          >
            What it does not do
          </Link>
        </div>
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-3">
        {CAPABILITIES.map((item) => (
          <article
            key={item.title}
            className="rounded-xl border border-line bg-card p-5"
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-low">
              {item.tag}
            </span>
            <h2 className="mt-3 text-[15px] font-semibold text-hi">
              {item.title}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-mid">
              {item.body}
            </p>
          </article>
        ))}
      </section>

      <footer className="mt-auto pt-16 text-[12px] text-low">
        <p>
          Every phase is written down in{" "}
          <span className="font-mono text-mid">OPENMI_BUILD_PHASES.md</span>.
          Sign-in, repositories and chat arrive in phases 1–3.
        </p>
      </footer>
    </main>
  );
}
