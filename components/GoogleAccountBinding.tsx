"use client";

import { Link2, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/client";

function setNextCookie(next: string) {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `openmi_next=${encodeURIComponent(next)}; Path=/; Max-Age=600; SameSite=Lax${secure}`;
}

export function GoogleAccountBinding({
  bound,
  googleEmail,
  canUnbind,
}: {
  bound: boolean;
  googleEmail: string | null;
  /** False when Google is the account's sole sign-in identity. */
  canUnbind: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function bindGoogle() {
    const supabase = supabaseBrowser();
    if (!supabase) {
      setError("Account linking is unavailable right now. Try again shortly.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    setNextCookie("/settings?saved=google-bound");

    const { error: linkError } = await supabase.auth.linkIdentity({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/settings?saved=google-bound")}`,
        queryParams: { prompt: "select_account" },
      },
    });

    if (linkError) {
      setBusy(false);
      const lower = linkError.message.toLowerCase();
      if (lower.includes("manual linking")) {
        setError(
          "Manual account linking is not enabled in Supabase Auth yet. Enable it under Authentication → Settings."
        );
      } else if (lower.includes("provider")) {
        setError("Google sign-in is not enabled in Supabase Auth yet.");
      } else {
        setError(linkError.message);
      }
    }
  }

  async function unbindGoogle() {
    if (!canUnbind) return;

    const supabase = supabaseBrowser();
    if (!supabase) {
      setError("Account unlinking is unavailable right now. Try again shortly.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const { data, error: identitiesError } =
        await supabase.auth.getUserIdentities();
      if (identitiesError) throw identitiesError;

      const identities = data?.identities ?? [];
      if (identities.length < 2) {
        setError(
          "You cannot unbind Google while it is your only sign-in method."
        );
        return;
      }

      const googleIdentity = identities.find(
        (identity) => identity.provider === "google"
      );
      if (!googleIdentity) {
        router.refresh();
        return;
      }

      const { error: unlinkError } =
        await supabase.auth.unlinkIdentity(googleIdentity);
      if (unlinkError) throw unlinkError;

      setNotice("Google account unbound.");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not unbind Google right now. Try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-3.5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-raised"
          >
            <svg className="size-4.5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14px] font-semibold text-hi">Google</p>
              <span
                className={`rounded-md px-2 py-0.5 font-mono text-[10.5px] font-medium ${
                  bound
                    ? "bg-accent-soft text-accent-text"
                    : "border border-line bg-raised text-low"
                }`}
              >
                {bound ? "Bound" : "Not bound"}
              </span>
            </div>

            <p className="mt-1 text-[12.5px] leading-relaxed text-mid">
              {bound
                ? googleEmail
                  ? `Signed-in identity: ${googleEmail}`
                  : "Linked for one-click Google sign-in."
                : "Bind your Google account so you can sign in with Google alongside email."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {bound ? (
            <button
              type="button"
              onClick={unbindGoogle}
              disabled={busy || !canUnbind}
              title={
                canUnbind
                  ? "Unbind Google account"
                  : "Cannot unbind your only sign-in method"
              }
              className="btn gap-1.5 px-3.5 py-2 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Unlink
                aria-hidden="true"
                className="size-3.5"
                strokeWidth={1.75}
              />
              <span>{busy ? "Unbinding…" : "Unbind"}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={bindGoogle}
              disabled={busy}
              className="btn btn-primary gap-1.5 px-3.5 py-2 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Link2
                aria-hidden="true"
                className="size-3.5"
                strokeWidth={1.75}
              />
              <span>{busy ? "Redirecting…" : "Bind Google"}</span>
            </button>
          )}
        </div>
      </div>

      {bound && !canUnbind && (
        <p className="mt-3 text-[12px] text-low">
          Google is currently your only sign-in method, so it cannot be unbound
          without locking you out.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger/30 bg-danger/8 px-3.5 py-2 text-[12px] text-danger"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="mt-3 rounded-lg border border-accent/30 bg-accent-soft px-3.5 py-2 text-[12px] text-accent-text"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
