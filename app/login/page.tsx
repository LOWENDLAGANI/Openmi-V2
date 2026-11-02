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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      <Brand />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight text-hi">
        Sign in to Openmi
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-mid">
        Your chats, folders and repository connection belong to your account
        and are protected by row-level security, not by a route guard.
      </p>

      <AuthForm next={next} configured={session.state !== "unconfigured"} />

      <p className="mt-6 text-[11px] leading-relaxed text-low">
        By signing in you accept that the agent reads repository content you
        have access to, and that nothing is committed without your approval.
      </p>
    </main>
  );
}
