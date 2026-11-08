import {
  acceptChange,
  approveProposal,
  forgetAutoApproval,
  rejectChange,
  undoChangeset,
} from "@/app/chat/actions";
import { ExecutionPanel } from "@/components/ExecutionPanel";
import { SubmitButton } from "@/components/SubmitButton";
import { changesetDisplayStatus, type ChangesetStatus } from "@/lib/changesets";
import type { ReviewChangeset } from "@/lib/changesets/store";

/**
 * The review card.
 *
 * It renders what is stored, not what a request hoped: an edit that failed to
 * apply has no diff and says why, an expired changeset says it expired, and an
 * applied one links to the commit GitHub created. No state here is optimistic,
 * and no label claims a build, test or commit happened.
 *
 * Applying is one button. The old approve-then-merge-on-GitHub pair is gone, so
 * the copy talks about the change rather than the machinery behind it. The panel
 * is a server component; the only interactivity is a form per file that posts to
 * a server action, so the row is the single source of truth.
 */

const STATUS_LABEL: Record<ChangesetStatus, string> = {
  draft: "Draft — not signed yet",
  ready: "Ready for review",
  approved: "Applying",
  committed: "Applied",
  failed: "Not applied",
  expired: "Expired",
  reverted: "Undone",
};

function commitHref(repo: string, sha: string | null): string | null {
  if (!sha) return null;
  return `https://github.com/${repo}/commit/${sha}`;
}

function DiffBlock({ text }: { text: string }) {
  if (text.length === 0) return null;

  return (
    <pre className="max-h-64 overflow-auto rounded-xl border border-line bg-canvas px-3 py-2 font-mono text-[11px] leading-[1.6]">
      {text.split("\n").map((line, index) => {
        const tone = line.startsWith("+")
          ? "text-accent-text"
          : line.startsWith("-")
            ? "text-danger"
            : line.startsWith("@@")
              ? "text-low"
              : "text-body";

        return (
          <span key={index} className={`block whitespace-pre ${tone}`}>
            {line.length === 0 ? " " : line}
          </span>
        );
      })}
    </pre>
  );
}

export function ReviewPanel({
  changesets,
  chatId,
  chatSha,
  chatBranch,
  autoApproveBranch,
  autoWrite,
}: {
  changesets: ReviewChangeset[];
  chatId: string;
  chatSha: string | null;
  /** The branch this chat is pinned to, shown on the standing approval. */
  chatBranch: string | null;
  /** Set when this branch is already approved without asking. */
  autoApproveBranch: string | null;
  /** True when a ready diff is written without an approval click. */
  autoWrite: boolean;
}) {
  if (changesets.length === 0) return null;

  return (
    <section aria-label="Proposed changes" className="space-y-2">
      {changesets.map((changeset) => {
        const status = changesetDisplayStatus(changeset);
        const accepted = changeset.files.filter(
          (file) => file.error === null && file.accepted
        );
        const additions = accepted.reduce((total, file) => total + file.additions, 0);
        const deletions = accepted.reduce((total, file) => total + file.deletions, 0);
        const stale = chatSha !== null && chatSha !== changeset.base_sha;
        const reviewable = status === "ready";
        const appliedHref = commitHref(
          changeset.repo_full_name,
          changeset.merge_commit_sha ?? changeset.commit_sha
        );
        const revertedHref = commitHref(
          changeset.repo_full_name,
          changeset.reverted_commit_sha
        );

        return (
          <details
            key={changeset.id}
            open={status === "ready" || status === "draft"}
            className="panel overflow-hidden"
          >
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                <span className="text-[12.5px] font-semibold text-hi">
                  Proposed changes
                </span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-low">
                {changeset.files.length} file(s) · +{additions} −{deletions} ·{" "}
                {STATUS_LABEL[status]}
              </span>
            </summary>

            <div className="space-y-3 border-t border-line px-4 py-3">
              <p className="eyebrow">
                suggested against {changeset.base_sha.slice(0, 7)} · expires{" "}
                {changeset.expires_at.slice(0, 16).replace("T", " ")} UTC
              </p>

              {stale && chatSha && (
                <p
                  role="status"
                  className="rounded-2xl border border-warn/25 bg-warn/8 px-4 py-2.5 text-[11px] leading-relaxed text-warn"
                >
                  This suggestion was made against {changeset.base_sha.slice(0, 7)},
                  but the chat has moved to {chatSha.slice(0, 7)}. Ask for a fresh
                  suggestion before applying it.
                </p>
              )}

              {autoApproveBranch && !autoWrite && (
                <div className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-2.5">
                  <p className="text-[11px] leading-relaxed text-accent-text">
                    Auto-apply is on for{" "}
                    <span className="font-mono">{autoApproveBranch}</span>: a ready
                    suggestion here is applied without asking.
                  </p>
                  <form action={forgetAutoApproval} className="mt-2">
                    <input type="hidden" name="chatId" value={chatId} />
                    <input
                      type="hidden"
                      name="branch"
                      value={autoApproveBranch}
                    />
                    <SubmitButton
                      className="btn px-3 py-1 text-[10.5px]"
                      pendingText="Saving…"
                    >
                      Turn off
                    </SubmitButton>
                  </form>
                </div>
              )}

              <ul className="space-y-2">
                {changeset.files.map((file) => (
                  <li
                    key={file.id}
                    className="overflow-hidden rounded-2xl border border-line bg-raised"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <p className="min-w-0 truncate font-mono text-[11.5px] text-body">
                        {file.path}
                      </p>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-low">
                          {file.error
                            ? "not applied"
                            : `+${file.additions} −${file.deletions}`}
                          {file.diff_truncated ? " · diff truncated" : ""} ·{" "}
                          {file.accepted ? "accepted" : "rejected"}
                        </span>

                        {reviewable && (
                          <form action={file.accepted ? rejectChange : acceptChange}>
                            <input type="hidden" name="changesetId" value={changeset.id} />
                            <input type="hidden" name="chatId" value={chatId} />
                            <input type="hidden" name="fileId" value={file.id} />
                            <SubmitButton
                              className="btn px-3 py-0.5 text-[10.5px]"
                              pendingText="Saving…"
                            >
                              {file.accepted ? "Reject" : "Accept"}
                            </SubmitButton>
                          </form>
                        )}
                      </div>
                    </div>

                    {file.error && (
                      <p className="px-3 pb-2 text-[11px] leading-relaxed text-danger">
                        This file was not proposed: {file.error}
                      </p>
                    )}

                    <div className="px-2 pb-2">
                      <DiffBlock text={file.diff} />
                    </div>
                  </li>
                ))}
              </ul>

              <ExecutionPanel changesetId={changeset.id} status={status} />

              {status === "ready" && !autoWrite && (
                <form
                  action={approveProposal}
                  className="space-y-3 border-t border-line pt-3"
                >
                  <input type="hidden" name="changesetId" value={changeset.id} />
                  <input type="hidden" name="chatId" value={chatId} />

                  <label className="flex items-start gap-2 text-[11px] leading-relaxed text-body">
                    <input
                      type="checkbox"
                      name="remember"
                      value="1"
                      className="mt-0.5 size-3 accent-current"
                    />
                    <span>
                      Apply and don&apos;t ask again for{" "}
                      <span className="font-mono">{chatBranch ?? "main"}</span>.
                      Future suggestions here are applied without this step.
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="max-w-md text-[11px] leading-relaxed text-low">
                      {accepted.length === 0
                        ? "No files accepted."
                        : `${accepted.length} file(s) accepted.`}
                    </p>

                    {accepted.length > 0 && (
                      <SubmitButton
                        className="btn btn-primary px-4 py-1.5 text-[11.5px]"
                        pendingText="Applying…"
                      >
                        Apply changes
                      </SubmitButton>
                    )}
                  </div>
                </form>
              )}

              {status === "ready" && autoWrite && (
                <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-mid">
                  This suggestion is applied automatically without an approval click.
                </p>
              )}

              {status === "draft" && (
                <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-low">
                  Draft · not signed.
                </p>
              )}

              {status === "approved" && (
                <div className="space-y-2 border-t border-line pt-3">
                  <p className="text-[11px] leading-relaxed text-mid">
                    Applying this change to the repository…
                  </p>

                  {changeset.failure && (
                    <>
                      <p
                        role="alert"
                        className="rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[11px] leading-relaxed text-danger"
                      >
                        {changeset.failure}
                      </p>

                      <form
                        action={approveProposal}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <input type="hidden" name="changesetId" value={changeset.id} />
                        <input type="hidden" name="chatId" value={chatId} />

                        <SubmitButton
                          className="btn px-4 py-1.5 text-[11.5px]"
                          pendingText="Trying again…"
                        >
                          Try again
                        </SubmitButton>
                      </form>
                    </>
                  )}
                </div>
              )}

              {status === "expired" && (
                <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-warn">
                  Expired.
                </p>
              )}

              {status === "failed" && (
                <p
                  role="alert"
                  className="border-t border-line pt-3 text-[11px] leading-relaxed text-danger"
                >
                  {changeset.failure ?? "This change was not applied."}
                </p>
              )}

              {status === "committed" && (
                <div className="space-y-2 border-t border-line pt-3">
                  <p className="flex flex-wrap items-center gap-2 text-[11px] leading-relaxed text-mid">
                    <span className="font-medium text-hi">Changes applied</span>
                    {appliedHref && (
                      <a
                        href={appliedHref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-text underline-offset-2 hover:underline"
                      >
                        View the change
                      </a>
                    )}
                  </p>

                  {changeset.merge_commit_sha && (
                    <form action={undoChangeset}>
                      <input type="hidden" name="changesetId" value={changeset.id} />
                      <input type="hidden" name="chatId" value={chatId} />
                      <SubmitButton
                        className="btn px-3 py-1 text-[10.5px]"
                        pendingText="Undoing…"
                      >
                        Undo
                      </SubmitButton>
                    </form>
                  )}
                </div>
              )}

              {status === "reverted" && (
                <p className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[11px] leading-relaxed text-mid">
                  <span className="font-medium text-hi">Changes undone</span>
                  {revertedHref && (
                    <a
                      href={revertedHref}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-text underline-offset-2 hover:underline"
                    >
                      View the undo
                    </a>
                  )}
                </p>
              )}
            </div>
          </details>
        );
      })}
    </section>
  );
}
