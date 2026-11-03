import Link from "next/link";

import { Brand } from "@/components/Brand";

/**
 * The 404 for every unmatched address, and for a route that calls notFound().
 *
 * It deliberately says nothing about what might live at the address: /admin
 * answers 404 to a signed-in account without the operator role, and a page that
 * hinted "you are not allowed" would confirm the route exists.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-6 sm:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" aria-label="Openmi home">
          <Brand />
        </Link>
        <Link href="/chat" className="btn px-3.5 py-1.5 text-[12px]">
          Open workspace
        </Link>
      </header>

      <section className="flex flex-1 flex-col justify-center py-12">
        <p className="eyebrow text-accent-text">404 · not found</p>
        <h1 className="mt-4 max-w-xl text-[clamp(2.2rem,7vw,3.8rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-hi">
          This page is not here.
        </h1>
        <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-mid">
          The address was mistyped, or the page moved. Nothing was charged, no
          repository was read, and no branch was created by the visit.
        </p>

        <div className="mt-7 flex flex-wrap gap-2">
          <Link href="/" className="btn btn-primary px-4 py-2 text-[12.5px]">
            Back to the start
          </Link>
          <Link href="/chat" className="btn px-4 py-2 text-[12.5px]">
            Open workspace
          </Link>
          <Link href="/about" className="btn btn-quiet px-4 py-2 text-[12.5px]">
            Read the contract
          </Link>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-5">
        <p className="eyebrow">openmi · review before push</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-low">
          no build · no test · no merge
        </p>
      </footer>
    </main>
  );
}
