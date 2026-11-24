"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { OpenmiMark } from "@/components/OpenmiMark";
import { supabaseBrowser } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

/**
 * Carries the intended post-login destination across the OAuth round trip.
 */
function setNextCookie(next: string) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `openmi_next=${encodeURIComponent(next)}; Path=/; Max-Age=600; SameSite=Lax${secure}`;
}

function setInviteCookie(code: string) {
  if (typeof document === "undefined") return;
  const trimmed = code.trim();
  if (!trimmed) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `openmi_ref=${encodeURIComponent(trimmed)}; Path=/; Max-Age=600; SameSite=Lax${secure}`;
}

export function AuthForm({
  next,
  configured,
  initialInviteCode,
}: {
  next: string;
  configured: boolean;
  initialInviteCode?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialInviteCode ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState(initialInviteCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(target: Mode) {
    setMode(target);
    setError(null);
    setNotice(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;

    const supabase = supabaseBrowser();
    if (!supabase) {
      setError("Sign-in is unavailable. Try again shortly.");
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
          emailRedirectTo: `${window.location.origin}/auth/callback`,
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

  async function google() {
    if (!configured) return;

    const supabase = supabaseBrowser();
    if (!supabase) {
      setError("Sign-in is unavailable. Try again shortly.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    setNextCookie(next);
    setInviteCookie(inviteCode);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });

    if (oauthError) {
      setBusy(false);
      setError(
        oauthError.message.toLowerCase().includes("provider")
          ? "Google sign-in is not enabled in Supabase Auth yet."
          : "Google sign-in did not work. Try again."
      );
    }
  }

  if (!configured) {
    return (
      <div className="panel p-6 text-center">
        <p className="text-[14px] font-semibold text-hi">
          Sign-in is unavailable
        </p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-mid">
          The accounts service is unreachable right now. Try again shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col items-center text-center">
        <span className="grid size-12 place-items-center rounded-2xl border border-line-strong bg-card/90 shadow-[var(--card-shadow)] backdrop-blur-md">
          <OpenmiMark size={24} />
        </span>

        <h1 className="mt-5 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em] text-hi sm:text-[28px]">
          {mode === "signin" ? "Sign in to Openmi" : "Create an Openmi account"}
        </h1>

        <p className="mt-2 text-[13.5px] text-mid">
          {mode === "signin" ? (
            <>
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className="font-semibold text-hi underline-offset-4 hover:underline"
              >
                Create account.
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="font-semibold text-hi underline-offset-4 hover:underline"
              >
                Sign in.
              </button>
            </>
          )}
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Sign in or create an account"
        className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-line bg-raised/85 p-1 backdrop-blur-sm"
      >
        {(["signin", "signup"] as const).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={mode === value}
            onClick={() => switchMode(value)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              mode === value
                ? "bg-card text-hi shadow-[var(--card-shadow)]"
                : "text-mid hover:text-hi"
            }`}
          >
            {value === "signin" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={google}
        disabled={busy}
        aria-busy={busy}
        className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-xl border border-line-strong bg-card/85 px-4 py-3 text-[13.5px] font-medium text-hi shadow-[var(--card-shadow)] backdrop-blur-sm transition-colors hover:bg-hover disabled:opacity-60"
      >
        <GoogleMark />
        <span>{busy ? "Opening Google…" : "Continue with Google"}</span>
      </button>

      <div className="my-5 flex items-center gap-3.5" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[12px] text-low">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-[12.5px] font-medium text-mid"
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
            className="field rounded-xl bg-card/85 px-3.5 py-2.5 text-[14px] backdrop-blur-sm"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-[12.5px] font-medium text-mid"
          >
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="field rounded-xl bg-card/85 py-2.5 pl-3.5 pr-10 text-[14px] backdrop-blur-sm"
              placeholder="At least 8 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-1.5 my-auto grid size-8 place-items-center rounded-lg text-low transition-colors hover:text-hi"
            >
              {showPassword ? (
                <EyeOff className="size-4" strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <Eye className="size-4" strokeWidth={1.75} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {mode === "signup" && (
          <div>
            <label
              htmlFor="invite-code"
              className="mb-1.5 block text-[12.5px] font-medium text-mid"
            >
              Invite code <span className="font-normal text-low">(optional)</span>
            </label>
            <input
              id="invite-code"
              name="inviteCode"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              className="field rounded-xl bg-card/85 px-3.5 py-2.5 font-mono text-[13px] backdrop-blur-sm"
              placeholder="From the account that invited you"
            />
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger/8 px-3.5 py-2.5 text-[12.5px] text-danger"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-xl border border-accent/30 bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-accent-text"
          >
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className="btn btn-primary mt-1 w-full rounded-xl py-3 text-[13.5px] font-medium"
        >
          {busy
            ? mode === "signin"
              ? "Signing in…"
              : "Creating account…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-[11.5px] leading-relaxed text-low">
        By continuing, you agree to our{" "}
        <Link href="/terms" className="text-mid underline underline-offset-2 hover:text-hi">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-mid underline underline-offset-2 hover:text-hi">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="size-[16px] shrink-0"
    >
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.8c1.8 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.4l4 3.1C6.3 6.8 8.9 4.8 12 4.8Z"
      />
    </svg>
  );
}
