import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/AuthForm";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { INVITE_REWARD_CREDIT } from "@/lib/credits";
import { safeNextPath } from "@/lib/http/next-path";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in | Openmi",
  robots: {
    index: false,
    follow: false,
  },
};

/** Only ever redirect to a path on this origin, never back to sign-in. */
function safeNext(value: string | undefined): string {
  const next = safeNextPath(value, "https://openmi.invalid");
  return next.startsWith("/login") ? "/chat" : next;
}

function cleanRef(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  return /^[A-Za-z0-9_-]{3,32}$/.test(value) ? value : null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; deleted?: string; ref?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const ref = cleanRef(params.ref);
  const session = await getSession();

  if (session.state === "signed-in") redirect(next);

  const homeHref = ref ? `/?ref=${encodeURIComponent(ref)}` : "/";

  return (
    <div className="auth-stage flex min-h-dvh flex-col">
      <header className="border-b border-line bg-canvas">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
          <Link
            href={homeHref}
            className="t-link inline-flex items-center gap-1 text-[14px] font-medium text-mid hover:text-hi"
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <span>Home</span>
          </Link>

          <ThemeSwitcher variant="icon" />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-5 py-12 sm:px-6">
        {ref && (
          <p
            role="status"
            className="mb-5 rounded-[var(--r-md)] border border-accent/30 bg-accent-soft px-4 py-2.5 text-center text-[13px] leading-relaxed text-accent-text"
          >
            Invite code{" "}
            <code className="rounded-[var(--r-sm)] bg-card px-1.5 py-0.5 font-mono text-[12px] text-hi">
              {ref}
            </code>{" "}
            applied: +{INVITE_REWARD_CREDIT} bonus Credit on your first paid
            pass.
          </p>
        )}

        {params.deleted === "1" && (
          <p
            role="status"
            className="mb-5 rounded-[var(--r-md)] border border-accent/30 bg-accent-soft px-4 py-2.5 text-center text-[13px] leading-relaxed text-accent-text"
          >
            Your account and data have been deleted. You can create a new
            account at any time.
          </p>
        )}

        <AuthForm
          next={next}
          configured={session.state !== "unconfigured"}
          initialInviteCode={ref ?? undefined}
        />
      </main>
    </div>
  );
}
