import {
  ArrowLeft,
  KeyRound,
  Link2,
  Mail,
  Trash2,
  Unlink,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { GoogleAccountBinding } from "@/components/GoogleAccountBinding";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { TIMEZONES } from "@/lib/credits";
import { readCreditProfile } from "@/lib/credits/store";
import { readConnection } from "@/lib/github/token";
import { oauthConfigured } from "@/lib/oauth/github";
import { getSession } from "@/lib/session";
import {
  bindGithubToken,
  saveSettingsTimezone,
  unbindGithub,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settings — Openmi",
};

function savedMessage(saved: string | undefined): string | null {
  if (!saved) return null;
  if (saved === "timezone") return "Timezone saved.";
  if (saved === "google-bound") return "Google account bound.";
  if (saved === "github-unbound") return "GitHub account unbound.";
  return saved;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    connected?: string;
  }>;
}) {
  const params = await searchParams;
  const session = await getSession();

  if (session.state === "signed-out") {
    redirect("/login?next=%2Fsettings");
  }

  if (session.state === "unconfigured") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <div className="panel p-6">
          <p className="text-[12px] font-medium text-low">Unavailable</p>
          <h1 className="mt-1.5 text-[22px] font-semibold tracking-[-0.02em] text-hi">
            Openmi is unavailable right now
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-mid">
            We can&apos;t load your settings at the moment. Try again in a few
            minutes.
          </p>
        </div>
      </main>
    );
  }

  if (session.state === "banned") redirect("/banned");

  const { supabase, user } = session;

  const [authUserResult, githubConnection, profile] = await Promise.all([
    supabase.auth.getUser(),
    readConnection(supabase, user.id),
    readCreditProfile(supabase, user.id),
  ]);

  const identities = authUserResult.data.user?.identities ?? [];
  const googleIdentity =
    identities.find((identity) => identity.provider === "google") ?? null;
  const googleEmail =
    typeof googleIdentity?.identity_data?.email === "string"
      ? googleIdentity.identity_data.email
      : null;
  const hasEmailIdentity = identities.some(
    (identity) => identity.provider === "email"
  );
  const canUnbindGoogle = Boolean(googleIdentity) && identities.length >= 2;
  const githubOauthReady = oauthConfigured();

  const statusText = params.connected
    ? `GitHub account @${params.connected} bound.`
    : savedMessage(params.saved);

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/chat" aria-label="Back to chats">
              <Brand compact />
            </Link>
            <span aria-hidden="true" className="text-line-strong">
              /
            </span>
            <h1 className="truncate text-[14px] font-semibold tracking-[-0.02em] text-hi">
              Settings
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link href="/chat" className="btn gap-1.5 px-3 py-1.5 text-[12px]">
              <ArrowLeft
                aria-hidden="true"
                className="size-3.5"
                strokeWidth={1.75}
              />
              <span>Workspace</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="animate-enter mx-auto w-full max-w-3xl space-y-6 px-5 py-8 sm:px-8">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-hi">
            Account &amp; settings
          </h2>
          <p className="mt-1 text-[13.5px] text-mid">
            Manage bound accounts, sign-in methods, and workspace preferences.
          </p>
        </div>

        {params.error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger/8 px-4 py-2.5 text-[12.5px] text-danger"
          >
            {params.error}
          </p>
        )}

        {statusText && (
          <p
            role="status"
            className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent-text"
          >
            {statusText}
          </p>
        )}

        {/* ── Account Summary ────────────────────────────────────────────── */}
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-raised text-mid"
              >
                <Mail className="size-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-low">
                  Primary email
                </p>
                <p className="truncate font-mono text-[13.5px] font-medium text-hi">
                  {user.email ?? "No email address"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-medium ${
                  user.emailVerified
                    ? "bg-accent-soft text-accent-text"
                    : "border border-line bg-raised text-mid"
                }`}
              >
                {user.emailVerified ? "Verified" : "Unverified"}
              </span>
              {hasEmailIdentity && (
                <span className="rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[11px] font-medium text-mid">
                  Password enabled
                </span>
              )}
            </div>
          </div>
        </section>

        {/* ── Bound Accounts ─────────────────────────────────────────────── */}
        <section className="panel overflow-hidden">
          <div className="border-b border-line bg-raised px-5 py-3.5">
            <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-hi">
              Bound accounts
            </h3>
            <p className="mt-0.5 text-[12px] text-mid">
              Bind or unbind external accounts linked to your Openmi profile.
            </p>
          </div>

          <div className="divide-y divide-line">
            {/* Google Sign-in Identity */}
            <GoogleAccountBinding
              bound={Boolean(googleIdentity)}
              googleEmail={googleEmail}
              canUnbind={canUnbindGoogle}
            />

            {/* GitHub Repository Connection */}
            <div className="p-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-start gap-3.5">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-raised text-hi"
                  >
                    <svg className="size-4.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.07 11.07 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
                    </svg>
                  </span>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-semibold text-hi">
                        GitHub
                      </p>
                      <span
                        className={`rounded-md px-2 py-0.5 font-mono text-[10.5px] font-medium ${
                          githubConnection
                            ? "bg-accent-soft text-accent-text"
                            : "border border-line bg-raised text-low"
                        }`}
                      >
                        {githubConnection ? "Bound" : "Not bound"}
                      </span>
                    </div>

                    {githubConnection ? (
                      <p className="mt-1 text-[12.5px] leading-relaxed text-mid">
                        Bound as{" "}
                        <span className="font-mono font-medium text-hi">
                          @{githubConnection.login}
                        </span>{" "}
                        via{" "}
                        {githubConnection.via === "oauth"
                          ? "GitHub OAuth"
                          : `personal access token (····${githubConnection.lastFour})`}
                        .
                      </p>
                    ) : (
                      <p className="mt-1 text-[12.5px] leading-relaxed text-mid">
                        Bind GitHub to attach repositories, edit code, and open
                        pull requests from chat.
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {githubConnection ? (
                    <form action={unbindGithub}>
                      <SubmitButton
                        className="btn gap-1.5 px-3.5 py-2 text-[12.5px]"
                        pendingText="Unbinding…"
                      >
                        <Unlink
                          aria-hidden="true"
                          className="size-3.5"
                          strokeWidth={1.75}
                        />
                        <span>Unbind</span>
                      </SubmitButton>
                    </form>
                  ) : githubOauthReady ? (
                    <a
                      href="/auth/github?next=%2Fsettings"
                      className="btn btn-primary gap-1.5 px-3.5 py-2 text-[12.5px]"
                    >
                      <Link2
                        aria-hidden="true"
                        className="size-3.5"
                        strokeWidth={1.75}
                      />
                      <span>Bind GitHub</span>
                    </a>
                  ) : null}
                </div>
              </div>

              {!githubConnection && (
                <details
                  open={!githubOauthReady}
                  className="mt-4 rounded-lg border border-line bg-raised/60 px-3.5 py-2.5"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] font-medium text-mid hover:text-hi">
                    <KeyRound
                      aria-hidden="true"
                      className="size-3.5 text-low"
                      strokeWidth={1.75}
                    />
                    <span>
                      {githubOauthReady
                        ? "Or bind with a personal access token"
                        : "Bind with a GitHub personal access token"}
                    </span>
                  </summary>

                  <form
                    action={bindGithubToken}
                    className="mt-3 flex flex-col gap-2 sm:flex-row"
                  >
                    <label htmlFor="github-pat" className="sr-only">
                      GitHub personal access token
                    </label>
                    <input
                      id="github-pat"
                      name="token"
                      type="password"
                      required
                      autoComplete="off"
                      placeholder="ghp_… or github_pat_…"
                      className="field flex-1 py-2 font-mono text-[12.5px]"
                    />
                    <SubmitButton
                      className="btn px-3.5 py-2 text-[12.5px]"
                      pendingText="Binding…"
                    >
                      Bind token
                    </SubmitButton>
                  </form>
                </details>
              )}
            </div>
          </div>
        </section>

        {/* ── Preferences ────────────────────────────────────────────────── */}
        <section className="panel divide-y divide-line overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <h3 className="text-[14px] font-semibold text-hi">Appearance</h3>
              <p className="mt-0.5 text-[12.5px] text-mid">
                Switch between Paper light, Obsidian dark, and Midnight slate.
              </p>
            </div>
            <ThemeSwitcher />
          </div>

          {profile && (
            <div className="p-5">
              <h3 className="text-[14px] font-semibold text-hi">
                Daily refill timezone
              </h3>
              <p className="mt-0.5 text-[12.5px] text-mid">
                Daily credits reset at local midnight in this zone.
              </p>

              <form
                action={saveSettingsTimezone}
                className="mt-3.5 flex flex-wrap gap-2"
              >
                <select
                  name="timezone"
                  defaultValue={profile.timezone}
                  aria-label="Timezone"
                  className="field min-w-[200px] flex-1 py-2 text-[12.5px]"
                >
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
                <SubmitButton
                  className="btn px-3.5 py-2 text-[12.5px]"
                  optimisticText="Saved"
                >
                  Save timezone
                </SubmitButton>
              </form>
            </div>
          )}
        </section>

        {/* ── Danger Zone ────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-danger/30 bg-danger/5 p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-[14px] font-semibold text-danger">
                Delete account
              </h3>
              <p className="mt-0.5 text-[12.5px] text-mid">
                Permanently remove your Openmi account, chats, bound tokens, and
                Credit history.
              </p>
            </div>
            <Link
              href="/account/delete"
              className="btn shrink-0 gap-1.5 border-danger/40 bg-danger/10 px-3.5 py-2 text-[12.5px] font-medium text-danger hover:bg-danger/15"
            >
              <Trash2
                aria-hidden="true"
                className="size-3.5"
                strokeWidth={1.75}
              />
              <span>Delete account</span>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
