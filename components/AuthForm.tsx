"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export function AuthForm({
  next,
  configured,
}: {
  next: string;
  configured: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;

    const supabase = supabaseBrowser();
    if (!supabase) {
      setError("Supabase is not configured for this deployment.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;

        router.push(next);
        router.refresh();
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          data:
            inviteCode.trim().length > 0
              ? { invite_code: inviteCode.trim() }
              : undefined,
        },
      });
      if (signUpError) throw signUpError;

      if (data.session) {
        router.push(next);
        router.refresh();
        return;
      }

      setNotice(
        "Account created. Check your email to confirm it, then sign in here."
      );
      setMode("signin");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "That did not work. Try again."
      );
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="mt-6 rounded-xl border border-line bg-card p-4">
        <p className="text-[13px] font-medium text-hi">
          Supabase is not configured
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-mid">
          Sign-in needs a project URL and an anon key. The setup page lists
          exactly what is missing and where each value comes from.
        </p>
        <a
          href="/setup"
          className="mt-3 inline-block rounded-lg border border-line bg-raised px-3 py-1.5 text-[12px] font-medium text-body hover:bg-hover"
        >
          Open setup
        </a>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-card p-5">
      <div
        role="tablist"
        aria-label="Sign in or create an account"
        className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-canvas p-1"
      >
        {(["signin", "signup"] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
              setNotice(null);
            }}
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
              mode === value
                ? "bg-chip text-hi"
                : "text-mid hover:text-hi"
            }`}
          >
            {value === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <div>
          <label
            htmlFor="email"
            className="block text-[11px] uppercase tracking-[0.12em] text-low"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-body placeholder:text-low focus:border-line-strong"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-[11px] uppercase tracking-[0.12em] text-low"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-body placeholder:text-low focus:border-line-strong"
            placeholder="At least 8 characters"
          />
        </div>

        {mode === "signup" && (
          <div>
            <label
              htmlFor="invite-code"
              className="block text-[11px] uppercase tracking-[0.12em] text-low"
            >
              Invite code (optional)
            </label>
            <input
              id="invite-code"
              name="inviteCode"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[12px] text-body placeholder:text-low focus:border-line-strong"
              placeholder="From the account that invited you"
            />
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-[12px] text-accent"
          >
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy
            ? "Working…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      <p className="mt-4 text-[11px] leading-relaxed text-low">
        Passwords are handled by Supabase Auth and never reach this app&apos;s
        database.
      </p>
    </div>
  );
}
