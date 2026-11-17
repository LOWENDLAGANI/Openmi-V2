import { undoChangeset } from "@/app/chat/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { loadAppliedChangesets } from "@/lib/changesets/store";

/**
 * Undo, where it can be found.
 *
 * The applied review card is no longer rendered: a change that reached the
 * repository has nothing left to decide, and the transcript already says it was
 * written. Undo was the one thing on that card still worth a click, so the rows
 * it acted on are listed here, in the workspace dialog. The write behind the
 * button is unchanged — `lib/changesets/undo.ts` re-checks ownership, the merge
 * commit and the not-already-undone rule before GitHub is touched.
 */

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
    <div className="fade-in">
      <p className="eyebrow px-3 pt-1">published to github</p>
      <p className="mt-1 px-3 pb-2 text-[11px] leading-relaxed text-mid">
        Undo writes every accepted file back to its content before the change, as
        a new commit on the default branch.
      </p>

      {error ? (
        <p
          role="alert"
          className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-danger"
        >
          The published changes could not be read: {error}
        </p>
      ) : changesets.length === 0 ? (
        <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-mid">
          Nothing published from this chat yet.
        </p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {changesets.map((change) => {
            const sha = change.merge_commit_sha ?? change.commit_sha ?? "";
            const branch = change.branch_name ?? "the default branch";

            return (
              <li
                key={change.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2"
              >
                <span className="font-mono text-[10.5px] text-low">
                  {sha.slice(0, 7)}
                </span>
                <span className="min-w-0 truncate font-mono text-[11.5px] text-hi">
                  {branch}
                </span>
                <span className="text-[10.5px] text-low">
                  {stamp(change.created_at)}
                </span>

                <div className="ml-auto flex items-center gap-2">
                  {sha && (
                    <a
                      href={`https://github.com/${change.repo_full_name}/commit/${sha}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10.5px] text-accent-text underline-offset-2 hover:underline"
                    >
                      View
                    </a>
                  )}

                  <form action={undoChangeset}>
                    <input type="hidden" name="changesetId" value={change.id} />
                    <input type="hidden" name="chatId" value={chatId} />
                    <SubmitButton
                      className="btn px-2 py-0.5 text-[10.5px]"
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
