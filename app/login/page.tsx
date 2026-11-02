import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/AuthForm";
import { Brand } from "@/components/Brand";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — Openmi",
};

/** Only ever redirect to a path on this origin. */
function safeNext(value: string | undefined): string {
  if (!value) return "/chat";
  if (!value.startsWith("/") || value.startsWith("//")) return "/chat";
  if (value.startsWith("/login")) return "/chat";
  return value;
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
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" aria-label="Openmi home">
          <Brand />
        </Link>
        <Link href="/about" className="btn btn-quiet px-3 py-1.5 text-[12px]">
          About
        </Link>
      </header>

      <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="max-w-lg">
          <p className="eyebrow">sign in</p>
          <h1 className="mt-4 text-[clamp(2rem,5.4vw,3.1rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-hi">
            Sign in to Openmi
          </h1>
          <p className="mt-4 text-[13.5px] leading-relaxed text-mid">
            Your chats, folders and repository connection belong to your account
            and are protected by row-level security, not by a route guard.
          </p>

          <div className="rule my-8 max-w-sm" />

          <p className="max-w-sm text-[11px] leading-relaxed text-low">
            By signing in you accept that the agent reads repository content you
            have access to, and that nothing is committed without your approval.
          </p>
        </section>

        <div className="w-full">
          <AuthForm next={next} configured={session.state !== "unconfigured"} />
        </div>
      </div>
    </main>
  );
}
