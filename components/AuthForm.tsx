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
      <div className="panel mt-8 p-5">
        <p className="text-[13.5px] font-semibold text-hi">
          Supabase is not configured
        </p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-mid">
          Sign-in needs a project URL and an anon key. Ask the operator to finish
          the deployment configuration; the admin panel lists exactly what is
          missing and where each value comes from.
        </p>
      </div>
    );
  }

  return (
    <div className="panel mt-8 p-4 sm:p-5">
      <div
        role="tablist"
        aria-label="Sign in or create an account"
        className="grid grid-cols-2 gap-1 rounded-full bg-canvas p-1"
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
            className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
              mode === value
                ? "bg-card text-hi shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
                : "text-mid hover:text-hi"
            }`}
          >
            {value === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div>
          <label htmlFor="email" className="eyebrow block px-1 pb-1.5">
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
            className="field py-2.5"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="eyebrow block px-1 pb-1.5">
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
            className="field py-2.5"
            placeholder="At least 8 characters"
          />
        </div>

        {mode === "signup" && (
          <div>
            <label htmlFor="invite-code" className="eyebrow block px-1 pb-1.5">
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
              className="field py-2.5 font-mono text-[12px]"
              placeholder="From the account that invited you"
            />
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12px] text-danger"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12px] text-accent-text"
          >
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary w-full py-2.5 text-[13px]"
        >
          {busy
            ? "Working…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      <p className="mt-4 px-1 text-[11px] leading-relaxed text-low">
        Passwords are handled by Supabase Auth and never reach this app&apos;s
        database.
      </p>
    </div>
  );
}
