import { FileCode2, GitBranch, Lock } from "lucide-react";
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

const HIGHLIGHTS = [
  {
    icon: GitBranch,
    title: "Isolated agent branches",
    detail: "Edits publish to openmi/agent/<id> with a pull request targeting your base.",
  },
  {
    icon: FileCode2,
    title: "Verified commit citations",
    detail: "Every file path and line number is checked against the pinned commit.",
  },
  {
    icon: Lock,
    title: "Sealed repository access",
    detail: "GitHub grants stay encrypted on the server and are never sent to the browser.",
  },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; deleted?: string }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const session = await getSession();

  if (session.state === "signed-in") redirect(next);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="Openmi home">
            <Brand />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link href="/about" className="btn btn-quiet px-3 py-1.5 text-[12.5px]">
              About
            </Link>
          </div>
        </div>
      </header>

      <main className="animate-enter mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-10 sm:px-8">
        {params.deleted === "1" && (
          <p
            role="status"
            className="mb-6 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12.5px] leading-relaxed text-accent-text"
          >
            Your account and the data we held for it have been deleted. You can
            create a new account at any time.
          </p>
        )}

        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center">
          <section className="max-w-lg">
            <h1 className="text-[clamp(1.9rem,4.4vw,2.75rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-hi">
              Sign in to Openmi
            </h1>
            <p className="mt-4 text-[14.5px] leading-[1.65] text-mid">
              Your conversations, files, and repository connections remain
              private to your account. Changes arrive as dedicated branches and
              pull requests named directly in each thread.
            </p>

            <ul className="mt-8 space-y-4 border-t border-line pt-6">
              {HIGHLIGHTS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.title} className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-raised text-accent-text">
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-hi">{item.title}</p>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-mid">
                        {item.detail}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="w-full">
            <AuthForm next={next} configured={session.state !== "unconfigured"} />
          </div>
        </div>
      </main>
    </div>
  );
}
