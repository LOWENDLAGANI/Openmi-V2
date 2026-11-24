import Link from "next/link";

import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="Openmi home">
            <Brand />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link href="/chat" className="btn px-3.5 py-1.5 text-[12.5px]">
              Open workspace
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-12 sm:px-8">
        <p className="font-mono text-[12px] font-medium text-accent-text">
          404 · Not found
        </p>
        <h1 className="mt-3 max-w-xl text-[clamp(2.1rem,6vw,3.4rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-hi">
          This page is not here.
        </h1>
        <p className="mt-4 max-w-md text-[14px] leading-relaxed text-mid">
          The address was mistyped or the page moved. Nothing was charged, no
          repository was read, and no branch was created by the visit.
        </p>

        <div className="mt-7 flex flex-wrap gap-2.5">
          <Link href="/" className="btn btn-primary px-4 py-2 text-[13px]">
            Back to home
          </Link>
          <Link href="/chat" className="btn px-4 py-2 text-[13px]">
            Open workspace
          </Link>
          <Link href="/pricing" className="btn btn-quiet px-4 py-2 text-[13px]">
            View pricing
          </Link>
          <Link href="/about" className="btn btn-quiet px-4 py-2 text-[13px]">
            Read the contract
          </Link>
        </div>
      </main>

      <footer className="border-t border-line py-5">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-5 text-[12px] text-low sm:px-8">
          <p className="font-mono">© 2026 Openmi</p>
          <p>Isolated branches · Observed exit codes</p>
        </div>
      </footer>
    </div>
  );
}
