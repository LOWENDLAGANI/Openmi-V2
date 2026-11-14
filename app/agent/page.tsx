import Link from "next/link";

import { AgentLauncher } from "@/components/AgentLauncher";
import { RUN_DAILY_RUNS, RUN_DAILY_TOKENS, RUN_MAX_CONCURRENT } from "@/lib/runs/limits";
import { stopSentence } from "@/lib/runs/events";
import { listRuns, readQuota } from "@/lib/runs/store";
import { requireSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The run surface.
 *
 * Every number on this page comes from the server: the chats are read through
 * the reader's client, the quota through the service role for this account,
 * and the runs through RLS. The browser is a view over those rows.
 */
export default async function AgentPage() {
  const session = await requireSession("/agent");

  const [{ data: chats }, runs] = await Promise.all([
    session.supabase
      .from("chats")
      .select("id, title, repo_full_name, deleted_at")
      .order("updated_at", { ascending: false })
      .limit(50),
    listRuns(session.supabase, 12),
  ]);

  const chatOptions = ((chats ?? []) as Array<{
    id: string;
    title: string;
    repo_full_name: string | null;
    deleted_at: string | null;
  }>)
    .filter((chat) => !chat.deleted_at)
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      repo: chat.repo_full_name,
    }));

  const admin = supabaseAdmin();
  const quota = admin
    ? await readQuota(admin, session.user.id)
    : { active: 0, runsToday: 0, tokensToday: 0 };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-10">
      <header>
        <p className="text-[11px] uppercase tracking-[0.14em] text-low">Openmi</p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.03em] text-hi">Agent runs</h1>
        <p className="mt-2 max-w-prose text-[13px] leading-6 text-low">
          A run is executed by a worker in its own isolated workspace. The browser sends the
          prompt, reads the event stream and shows you what the server recorded. Closing this
          tab does not stop a run.
        </p>
        <p className="mt-2 text-[12px] text-low">
          Today: {quota.runsToday} of {RUN_DAILY_RUNS} runs · {quota.tokensToday.toLocaleString()}{" "}
          of {RUN_DAILY_TOKENS.toLocaleString()} tokens · {RUN_MAX_CONCURRENT} at a time.
        </p>
      </header>

      <AgentLauncher chats={chatOptions} />

      <section className="rounded-3xl border border-line bg-raised px-5 py-4">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.14em] text-low">
          Recent runs
        </h2>

        {runs.length === 0 ? (
          <p className="mt-3 text-[13px] text-low">No runs yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col">
            {runs.map((run) => (
              <li key={run.id} className="border-t border-line py-3 first:border-t-0 first:pt-0">
                <Link href={`/agent/${run.id}`} className="block min-w-0">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px] text-hi [overflow-wrap:anywhere]">
                      {run.prompt.slice(0, 140)}
                    </span>
                    <span className="text-[11px] text-low">
                      {stopSentence(run.status, run.stop_reason)}
                    </span>
                  </span>
                  <span className="mt-1 block text-[11px] text-low">
                    {run.model} · {run.steps} step(s) ·{" "}
                    {(run.input_tokens + run.output_tokens).toLocaleString()} tokens
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
