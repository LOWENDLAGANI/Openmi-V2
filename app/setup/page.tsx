import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { SetupReport } from "@/components/SetupReport";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { readAdminAccess } from "@/lib/admin/access";

// Configuration is read per request. A setup page served from a shared cache
// would lie about the deployment it is describing.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Setup — Openmi",
  robots: { index: false, follow: false },
};

/**
 * The setup report is an operator surface, not a public page.
 *
 * It is linked from /admin, and this route checks the same operator role. The
 * one exception is a deployment with no Supabase at all: there is no account to
 * check, and this is the only page that can say which key is missing.
 */
export default async function SetupPage() {
  const access = await readAdminAccess();

  if (access.state === "signed-out") redirect("/login?next=%2Fsetup");
  if (access.state === "forbidden") notFound();

  return (
    <main className="animate-enter mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" aria-label="Openmi home">
          <Brand compact />
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-1.5">
          <ThemeSwitcher />
          <Link href="/admin" className="btn btn-quiet px-3 py-1.5 text-[12px]">
            Admin
          </Link>
          <Link href="/chat" className="btn px-3.5 py-1.5 text-[12px]">
            Workspace
          </Link>
        </nav>
      </header>

      <p className="eyebrow mt-14">deployment truth</p>
      <h1 className="mt-3 text-[clamp(1.9rem,5vw,2.7rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
        Setup
      </h1>
      <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-mid">
        Everything this deployment needs, whether it is present, whether the
        database schema matches this checkout, and which live services answer.
        Values are never read back — only whether a key is set. Operators reach
        this page from the admin panel; it is not part of the public site.
      </p>

      <SetupReport />

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6">
        <p className="eyebrow">nothing here is a secret value</p>
        <Link href="/admin" className="eyebrow hover:text-hi">
          back to admin ›
        </Link>
      </footer>
    </main>
  );
}
