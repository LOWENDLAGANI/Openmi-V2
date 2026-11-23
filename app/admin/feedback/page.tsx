import {
  ArrowLeft,
  ArrowUpRight,
  Bug,
  Lightbulb,
} from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Brand } from "@/components/Brand";
import { StatusPill } from "@/components/StatusPill";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { readAdminAccess } from "@/lib/admin/access";
import {
  FEEDBACK_STATUS_META,
  categoryLabel,
  type FeedbackKind,
  type FeedbackRow,
  type FeedbackStatus,
} from "@/lib/feedback";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reviewFeedback } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Reports & Suggestions — Admin — Openmi",
  robots: { index: false, follow: false },
};

type ProfileRow = {
  id: string;
  email: string | null;
  handle: string | null;
};

function utc(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}

function filterHref(kind?: string, status?: string): string {
  const search = new URLSearchParams();
  if (kind && kind !== "all") search.set("kind", kind);
  if (status && status !== "all") search.set("status", status);
  const query = search.toString();
  return query ? `/admin/feedback?${query}` : "/admin/feedback";
}

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    status?: string;
    error?: string;
    done?: string;
  }>;
}) {
  const params = await searchParams;
  const access = await readAdminAccess();

  if (access.state === "unconfigured") redirect("/setup");
  if (access.state === "signed-out") {
    redirect("/login?next=%2Fadmin%2Ffeedback");
  }
  if (access.state === "forbidden") notFound();

  const admin = supabaseAdmin();
  if (!admin) {
    return (
      <main className="animate-enter mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <p className="eyebrow">admin</p>
        <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-hi">
          Service role required
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mid">
          Reading member reports and suggestions requires
          SUPABASE_SERVICE_ROLE_KEY on the server.
        </p>
      </main>
    );
  }

  const filterKind: "all" | FeedbackKind =
    params.kind === "bug" || params.kind === "suggestion"
      ? params.kind
      : "all";

  const filterStatus: "all" | FeedbackStatus =
    params.status === "open" ||
    params.status === "in_progress" ||
    params.status === "resolved" ||
    params.status === "planned" ||
    params.status === "closed"
      ? params.status
      : "all";

  let query = admin
    .from("user_feedback")
    .select(
      "id, owner, kind, category, title, description, page_url, image_path, image_name, image_type, status, admin_note, reviewed_by, reviewed_at, created_at, updated_at"
    );

  if (filterKind !== "all") {
    query = query.eq("kind", filterKind);
  }
  if (filterStatus !== "all") {
    query = query.eq("status", filterStatus);
  }

  const [
    listResult,
    openBugsResult,
    openSuggestionsResult,
    totalBugsResult,
    totalSuggestionsResult,
  ] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(80),
    admin
      .from("user_feedback")
      .select("id", { count: "exact", head: true })
      .eq("kind", "bug")
      .eq("status", "open"),
    admin
      .from("user_feedback")
      .select("id", { count: "exact", head: true })
      .eq("kind", "suggestion")
      .eq("status", "open"),
    admin
      .from("user_feedback")
      .select("id", { count: "exact", head: true })
      .eq("kind", "bug"),
    admin
      .from("user_feedback")
      .select("id", { count: "exact", head: true })
      .eq("kind", "suggestion"),
  ]);

  const rows = (listResult.data ?? []) as FeedbackRow[];
  const openBugs = openBugsResult.count ?? 0;
  const openSuggestions = openSuggestionsResult.count ?? 0;
  const totalBugs = totalBugsResult.count ?? 0;
  const totalSuggestions = totalSuggestionsResult.count ?? 0;

  const ownerIds = [...new Set(rows.map((row) => row.owner))];
  const profilesResult = ownerIds.length
    ? await admin
        .from("profiles")
        .select("id, email, handle")
        .in("id", ownerIds)
    : { data: [] as ProfileRow[] };

  const profiles = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((row) => [row.id, row])
  );

  const signedImages = new Map<string, string>();
  await Promise.all(
    rows
      .filter((row) => row.image_path)
      .slice(0, 30)
      .map(async (row) => {
        if (!row.image_path) return;
        const { data } = await admin.storage
          .from("feedback")
          .createSignedUrl(row.image_path, 900);
        if (data?.signedUrl) signedImages.set(row.id, data.signedUrl);
      })
  );

  return (
    <main className="animate-enter mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/admin" aria-label="Back to admin">
            <Brand compact />
          </Link>
          <span aria-hidden="true" className="h-4 w-px bg-line-strong" />
          <div>
            <p className="eyebrow">admin / feedback</p>
            <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-hi">
              Bug Reports &amp; Suggestions
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ThemeSwitcher className="hidden sm:inline-flex" />
          <Link href="/admin" className="btn gap-1.5 px-3.5 py-1.5 text-[12px]">
            <ArrowLeft
              aria-hidden="true"
              className="size-3.5"
              strokeWidth={1.75}
            />
            <span>Operations</span>
          </Link>
          <Link href="/chat" className="btn px-3.5 py-1.5 text-[12px]">
            Workspace
          </Link>
        </div>
      </header>

      {params.error && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12px] text-danger"
        >
          {params.error}
        </p>
      )}

      {params.done === "updated" && (
        <p
          role="status"
          className="mt-5 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12px] text-accent-text"
        >
          Submission status and team response saved.
        </p>
      )}

      {listResult.error && (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[12px] leading-relaxed text-danger"
        >
          Feedback table is not readable: {listResult.error.message}. Apply{" "}
          <span className="font-mono">059_user_feedback.sql</span> with{" "}
          <span className="font-mono">supabase db push</span>.
        </p>
      )}

      {/* ── KPI Summary ─────────────────────────────────────────────────── */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "open bugs", value: String(openBugs) },
          { label: "open suggestions", value: String(openSuggestions) },
          { label: "total bug reports", value: String(totalBugs) },
          { label: "total suggestions", value: String(totalSuggestions) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-line bg-card px-4 py-3 shadow-[var(--card-shadow)]"
          >
            <p className="eyebrow">{stat.label}</p>
            <p className="mt-1 font-mono text-[20px] font-semibold leading-none tabular-nums text-hi">
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <section className="panel mt-5 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "all", label: `All (${totalBugs + totalSuggestions})` },
              { id: "bug", label: `Bug reports (${totalBugs})` },
              { id: "suggestion", label: `Suggestions (${totalSuggestions})` },
            ] as const
          ).map((tab) => {
            const active = filterKind === tab.id;
            return (
              <Link
                key={tab.id}
                href={filterHref(tab.id, filterStatus)}
                className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-accent text-on-accent"
                    : "border border-line bg-raised text-mid hover:text-hi"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "all", label: "Any status" },
              { id: "open", label: "Open" },
              { id: "in_progress", label: "In progress" },
              { id: "planned", label: "Planned" },
              { id: "resolved", label: "Resolved" },
              { id: "closed", label: "Closed" },
            ] as const
          ).map((tab) => {
            const active = filterStatus === tab.id;
            return (
              <Link
                key={tab.id}
                href={filterHref(filterKind, tab.id)}
                className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                  active
                    ? "border border-accent/40 bg-accent-soft text-accent-text"
                    : "border border-line bg-raised text-low hover:text-hi"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Submissions List ────────────────────────────────────────────── */}
      <section aria-label="Submissions" className="mt-5 space-y-4">
        {rows.length === 0 ? (
          <div className="panel p-8 text-center">
            <p className="text-[13px] text-mid">
              No submissions match the selected filter.
            </p>
          </div>
        ) : (
          rows.map((row) => {
            const member = profiles.get(row.owner);
            const state =
              FEEDBACK_STATUS_META[row.status] ?? FEEDBACK_STATUS_META.open;
            const imageUrl = signedImages.get(row.id);
            const isBug = row.kind === "bug";

            return (
              <article key={row.id} className="panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] font-medium ${
                        isBug
                          ? "border border-danger/30 bg-danger/10 text-danger"
                          : "bg-accent-soft text-accent-text"
                      }`}
                    >
                      {isBug ? (
                        <Bug
                          aria-hidden="true"
                          className="size-3"
                          strokeWidth={2}
                        />
                      ) : (
                        <Lightbulb
                          aria-hidden="true"
                          className="size-3"
                          strokeWidth={2}
                        />
                      )}
                      <span>{isBug ? "Bug report" : "Suggestion"}</span>
                    </span>

                    <span className="rounded-md border border-line bg-raised px-2 py-0.5 font-mono text-[11px] text-mid">
                      {categoryLabel(row.kind, row.category)}
                    </span>

                    <h2 className="text-[14.5px] font-semibold text-hi">
                      {row.title}
                    </h2>
                  </div>

                  <StatusPill tone={state.tone}>{state.label}</StatusPill>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-low">
                  <span>
                    From:{" "}
                    <strong className="font-medium text-mid">
                      {member?.email ?? member?.handle ?? row.owner}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>{utc(row.created_at)} UTC</span>
                  {row.page_url && (
                    <>
                      <span>·</span>
                      <span>Page/Repo: {row.page_url}</span>
                    </>
                  )}
                </div>

                <p className="mt-3 whitespace-pre-line rounded-lg border border-line bg-raised p-3.5 text-[13px] leading-relaxed text-body">
                  {row.description}
                </p>

                {row.image_path && (
                  <div className="mt-3">
                    {imageUrl ? (
                      <div className="space-y-1.5">
                        <a
                          href={imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group inline-block overflow-hidden rounded-lg border border-line bg-raised"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imageUrl}
                            alt={row.image_name ?? "Uploaded screenshot"}
                            className="max-h-64 w-auto object-contain transition-opacity group-hover:opacity-90"
                          />
                        </a>
                        <div>
                          <a
                            href={imageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-[11.5px] font-medium text-accent-text hover:underline"
                          >
                            <span>
                              Open full picture ({row.image_name ?? "screenshot"})
                            </span>
                            <ArrowUpRight
                              aria-hidden="true"
                              className="size-3.5"
                              strokeWidth={1.75}
                            />
                          </a>
                        </div>
                      </div>
                    ) : (
                      <p className="font-mono text-[11px] text-low">
                        Attached image: {row.image_name ?? row.image_path}
                      </p>
                    )}
                  </div>
                )}

                <form
                  action={reviewFeedback}
                  className="mt-4 grid gap-2 border-t border-line pt-3.5 sm:grid-cols-[150px_1fr_auto]"
                >
                  <input type="hidden" name="feedbackId" value={row.id} />
                  <input type="hidden" name="filterKind" value={filterKind} />
                  <input
                    type="hidden"
                    name="filterStatus"
                    value={filterStatus}
                  />

                  <select
                    name="status"
                    defaultValue={row.status}
                    aria-label="Status"
                    className="field py-1.5 text-[12px]"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="planned">Planned</option>
                    <option value="resolved">Resolved</option>
                    <option value="closed">Closed</option>
                  </select>

                  <input
                    name="note"
                    defaultValue={row.admin_note ?? ""}
                    maxLength={1000}
                    placeholder="Reply or status note shown to the user (optional)"
                    className="field py-1.5 text-[12px]"
                  />

                  <SubmitButton
                    className="btn btn-primary px-4 py-1.5 text-[12px]"
                    optimisticText="Saved"
                    pendingText="Saving…"
                  >
                    Update
                  </SubmitButton>
                </form>
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
