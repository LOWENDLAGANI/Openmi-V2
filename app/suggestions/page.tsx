import { ArrowLeft, Bug, Lightbulb } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdBanner } from "@/components/AdBanner";
import { Brand } from "@/components/Brand";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import {
  FEEDBACK_STATUS_META,
  SUGGESTION_CATEGORIES,
  categoryLabel,
  type FeedbackRow,
} from "@/lib/feedback";
import { getSession } from "@/lib/session";
import { submitSuggestion } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Suggestions — Openmi",
  robots: { index: false, follow: false },
};

function utc(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();

  if (session.state === "unconfigured") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <div className="panel p-6">
          <p className="text-[12px] font-medium text-low">Unavailable</p>
          <h1 className="mt-1.5 text-[22px] font-semibold tracking-[-0.02em] text-hi">
            Openmi is unavailable right now
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-mid">
            Suggestions require the database connection. Try again in a few
            minutes.
          </p>
        </div>
      </main>
    );
  }

  if (session.state === "signed-out") redirect("/login?next=%2Fsuggestions");
  if (session.state === "banned") redirect("/banned");

  const { supabase, user } = session;

  const { data } = await supabase
    .from("user_feedback")
    .select(
      "id, owner, kind, category, title, description, page_url, image_path, image_name, image_type, status, admin_note, reviewed_by, reviewed_at, created_at, updated_at"
    )
    .eq("owner", user.id)
    .eq("kind", "suggestion")
    .order("created_at", { ascending: false })
    .limit(20);

  const suggestions = (data ?? []) as FeedbackRow[];

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-3 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/chat" aria-label="Back to chats">
              <Brand compact />
            </Link>
            <span aria-hidden="true" className="text-line-strong">
              /
            </span>
            <h1 className="truncate text-[14px] font-semibold tracking-[-0.02em] text-hi">
              Suggestions
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <ThemeSwitcher variant="icon" />
            <Link
              href="/report"
              className="btn gap-1.5 px-3 py-1.5 text-[12px]"
            >
              <Bug
                aria-hidden="true"
                className="size-3.5 text-accent-text"
                strokeWidth={1.75}
              />
              <span>Report problem</span>
            </Link>
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

      <main className="animate-enter mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
        <AdBanner className="mb-6" />

        {params.error && (
          <p
            role="alert"
            className="mb-5 rounded-lg border border-danger/30 bg-danger/8 px-4 py-2.5 text-[12.5px] text-danger"
          >
            {params.error}
          </p>
        )}

        {params.submitted === "1" && (
          <p
            role="status"
            className="mb-5 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent-text"
          >
            Suggestion submitted. We review every idea in the admin panel and
            update its status below as it progresses.
          </p>
        )}

        <section
          aria-labelledby="suggestion-form-heading"
          className="panel p-6"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Lightbulb
                aria-hidden="true"
                className="size-4 text-accent-text"
                strokeWidth={1.75}
              />
              <h2
                id="suggestion-form-heading"
                className="text-[16px] font-semibold tracking-[-0.02em] text-hi"
              >
                Share a feature request or suggestion
              </h2>
            </div>
            <span className="font-mono text-[11px] text-low">
              {user.email}
            </span>
          </div>

          <p className="mt-1.5 text-[12.5px] text-mid">
            Tell us what would make Openmi faster or more useful for your GitHub
            workflow.
          </p>

          <form
            action={submitSuggestion}
            className="mt-5 grid gap-4 sm:grid-cols-2"
          >
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-body">
                Category
              </span>
              <select
                name="category"
                defaultValue={SUGGESTION_CATEGORIES[0].id}
                className="field py-2 text-[12.5px]"
              >
                {SUGGESTION_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[12px] font-medium text-body">
                Idea title
              </span>
              <input
                name="title"
                required
                minLength={3}
                maxLength={160}
                placeholder="e.g. Support custom preview start commands per repo"
                className="field py-2 text-[12.5px]"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-[12px] font-medium text-body">
                Details &amp; use case
              </span>
              <textarea
                name="description"
                required
                minLength={10}
                maxLength={4000}
                rows={4}
                placeholder="Explain the workflow this would improve and how you would use it…"
                className="field py-2 text-[12.5px] leading-relaxed"
              />
            </label>

            <SubmitButton
              className="btn btn-primary py-2.5 text-[13px] sm:col-span-2"
              optimisticText="Suggestion sent"
              pendingText="Submitting suggestion…"
            >
              Submit suggestion
            </SubmitButton>
          </form>
        </section>

        <section
          aria-labelledby="my-suggestions-heading"
          className="panel mt-6 overflow-hidden"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-raised px-5 py-3.5">
            <h2
              id="my-suggestions-heading"
              className="text-[14.5px] font-semibold tracking-[-0.015em] text-hi"
            >
              Your suggestions
            </h2>
            <p className="font-mono text-[11.5px] tabular-nums text-low">
              {suggestions.length} total · newest first
            </p>
          </div>

          {suggestions.length === 0 ? (
            <p className="px-5 py-5 text-[12.5px] text-mid">
              You haven&apos;t submitted any suggestions yet.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {suggestions.map((row) => {
                const state =
                  FEEDBACK_STATUS_META[row.status] ?? FEEDBACK_STATUS_META.open;

                return (
                  <li key={row.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[10.5px] font-medium text-mid">
                          {categoryLabel("suggestion", row.category)}
                        </span>
                        <h3 className="text-[13.5px] font-semibold text-hi">
                          {row.title}
                        </h3>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] tabular-nums text-low">
                          {utc(row.created_at)}
                        </span>
                        <StatusPill tone={state.tone}>{state.label}</StatusPill>
                      </div>
                    </div>

                    <p className="mt-2 whitespace-pre-line text-[12.5px] leading-relaxed text-mid">
                      {row.description}
                    </p>

                    {row.admin_note && (
                      <div className="mt-3 rounded-lg border border-accent/25 bg-accent-soft px-3.5 py-2.5 text-[12px] text-hi">
                        <span className="font-mono text-[10.5px] font-semibold text-accent-text">
                          Team response:
                        </span>{" "}
                        {row.admin_note}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
