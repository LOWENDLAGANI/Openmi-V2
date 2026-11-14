import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/AuthForm";
import { Brand } from "@/components/Brand";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { safeNextPath } from "@/lib/http/next-path";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — Openmi",
};

/** Only ever redirect to a path on this origin, never back to sign-in. */
function safeNext(value: string | undefined): string {
  const next = safeNextPath(value, "https://openmi.invalid");
  return next.startsWith("/login") ? "/chat" : next;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const session = await getSession();

  if (session.state === "signed-in") redirect(next);

  return (
    <main className="animate-enter mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" aria-label="Openmi home">
          <Brand />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <Link href="/about" className="btn btn-quiet px-3 py-1.5 text-[12px]">
            About
          </Link>
        </div>
      </header>

      <div className="grid flex-1 content-start items-start gap-10 py-10 sm:py-12 lg:grid-cols-[minmax(0,1fr)_380px] lg:content-center lg:items-center">
        <section className="max-w-lg">
          <h1 className="text-[clamp(2rem,5.4vw,3.1rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-hi">
            Sign in to Openmi
          </h1>
          <p className="mt-4 text-[13.5px] leading-[1.7] text-mid">
            Your chats, files and repository connection stay private to your
            account. Changes arrive as their own branch and pull request, and
            merging is yours to decide.
          </p>

          <div className="rule my-8 max-w-sm" />

          <p className="max-w-sm text-[11px] leading-relaxed text-low">
            The agent reads only repositories you already have access to.
          </p>
        </section>

        <div className="w-full">
          <AuthForm next={next} configured={session.state !== "unconfigured"} />
        </div>
      </div>
    </main>
  );
}
