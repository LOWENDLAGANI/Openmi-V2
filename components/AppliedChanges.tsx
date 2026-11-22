import { ExternalLink, GitCommit } from "lucide-react";

import { undoChangeset } from "@/app/chat/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { loadAppliedChangesets } from "@/lib/changesets/store";

type Reader = Parameters<typeof loadAppliedChangesets>[0];

function stamp(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export async function AppliedChanges({
  supabase,
  chatId,
}: {
  supabase: Reader;
  chatId: string;
}) {
  const { changesets, error } = await loadAppliedChangesets(supabase, chatId);

  return (
    <div className="fade-in panel overflow-hidden">
      <div className="border-b border-line bg-raised px-4 py-3">
        <p className="text-[13px] font-semibold text-hi">Published to GitHub</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-mid">
          Undo writes every changed file back to its prior content as a new
          commit on the default branch.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="px-4 py-3 text-[12px] leading-relaxed text-danger"
        >
          The published changes could not be read: {error}
        </p>
      ) : changesets.length === 0 ? (
        <p className="px-4 py-4 text-[12.5px] leading-relaxed text-mid">
          Nothing published from this chat yet.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {changesets.map((change) => {
            const sha = change.merge_commit_sha ?? change.commit_sha ?? "";
            const branch = change.branch_name ?? "the default branch";

            return (
              <li
                key={change.id}
                className="flex flex-wrap items-center gap-2.5 px-4 py-3"
              >
                <GitCommit aria-hidden="true" className="size-3.5 shrink-0 text-low" strokeWidth={1.75} />
                <span className="rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-mid">
                  {sha.slice(0, 7)}
                </span>
                <span className="min-w-0 truncate font-mono text-[12px] font-medium text-hi">
                  {branch}
                </span>
                <span className="font-mono text-[11px] text-low">
                  {stamp(change.created_at)}
                </span>

                <div className="ml-auto flex items-center gap-2">
                  {sha && (
                    <a
                      href={`https://github.com/${change.repo_full_name}/commit/${sha}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn px-2.5 py-1 text-[11.5px]"
                    >
                      <span>View</span>
                      <ExternalLink aria-hidden="true" className="size-3" strokeWidth={1.75} />
                    </a>
                  )}

                  <form action={undoChangeset}>
                    <input type="hidden" name="changesetId" value={change.id} />
                    <input type="hidden" name="chatId" value={chatId} />
                    <SubmitButton
                      className="btn px-2.5 py-1 text-[11.5px]"
                      optimisticText="Undoing…"
                    >
                      Undo
                    </SubmitButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
