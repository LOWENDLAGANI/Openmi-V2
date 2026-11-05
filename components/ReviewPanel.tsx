import { acceptChange, approveProposal, forgetAutoApproval, rejectChange } from "@/app/chat/actions";
import { ExecutionPanel } from "@/components/ExecutionPanel";
import { SubmitButton } from "@/components/SubmitButton";
import { AGENT_BRANCH_PREFIX } from "@/lib/branch";
import {
  changesetDisplayStatus,
  type ChangesetStatus,
} from "@/lib/changesets";
import type { ReviewChangeset } from "@/lib/changesets/store";

/**
 * The review card.
 *
 * It renders what is stored, not what a request hoped: an edit that failed to
 * apply has no diff and says why, an expired changeset says it expired, and an
 * approved one says that nothing has been written to GitHub. No state here is
 * optimistic, and no label claims a build, test or commit happened.
 *
 * The panel is a server component; the only interactivity is a form per file
 * that posts to a server action, so the row is the single source of truth.
 */

const STATUS_LABEL: Record<ChangesetStatus, string> = {
  draft: "Draft — not signed yet",
  ready: "Ready for review",
  approved: "Approved",
  committed: "Committed",
  failed: "Failed — no file could be proposed",
  expired: "Expired",
};

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
}: {
  changesets: ReviewChangeset[];
  chatId: string;
  chatSha: string | null;
  /** The branch this chat is pinned to, shown on the standing approval. */
  chatBranch: string | null;
  /** Set when this branch is already approved without asking. */
  autoApproveBranch: string | null;
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
        const directCommit =
          changeset.branch_name !== null &&
          !changeset.branch_name.startsWith(AGENT_BRANCH_PREFIX);

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
                base {changeset.base_sha.slice(0, 7)} · expires{" "}
                {changeset.expires_at.slice(0, 16).replace("T", " ")} UTC
              </p>

              {stale && chatSha && (
                <p
                  role="status"
                  className="rounded-2xl border border-warn/25 bg-warn/8 px-4 py-2.5 text-[11px] leading-relaxed text-warn"
                >
                  This diff was computed at {changeset.base_sha.slice(0, 7)}, but
                  the chat is pinned at {chatSha.slice(0, 7)} now. Re-ask before
                  approving it.
                </p>
              )}

              {autoApproveBranch && (
                <div className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-2.5">
                  <p className="text-[11px] leading-relaxed text-accent-text">
                    Auto-approve is on for{" "}
                    <span className="font-mono">{autoApproveBranch}</span>: a ready
                    diff on this branch is written without asking.
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

              {status === "ready" && (
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
                      Approve and don&apos;t ask again for{" "}
                      <span className="font-mono">{chatBranch ?? "main"}</span>.
                      Future diffs on this branch are written without this step.
                    </span>
                  </label>

                  <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <legend className="eyebrow mb-1 w-full">Destination</legend>

                    <label className="flex items-center gap-1.5 text-[11px] text-body">
                      <input
                        type="radio"
                        name="target"
                        value="pr"
                        defaultChecked
                        className="size-3 accent-current"
                      />
                      Open a pull request
                    </label>

                    <label className="flex items-center gap-1.5 text-[11px] text-body">
                      <input
                        type="radio"
                        name="target"
                        value="branch"
                        className="size-3 accent-current"
                      />
                      Commit to
                    </label>

                    <input
                      name="branch"
                      defaultValue="main"
                      maxLength={100}
                      spellCheck={false}
                      aria-label="Branch to commit to"
                      placeholder="main"
                      className="field w-32 py-1 text-[11px]"
                    />
                  </fieldset>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="max-w-md text-[11px] leading-relaxed text-low">
                      {accepted.length === 0
                        ? "No files are accepted, so there is nothing to approve."
                        : `${accepted.length} file(s) accepted. A pull request goes on its own branch; a direct commit writes the branch you named, and only while it is still at the base shown above.`}
                    </p>

                    {accepted.length > 0 && (
                      <SubmitButton
                        className="btn btn-primary px-4 py-1.5 text-[11.5px]"
                        pendingText="Writing…"
                      >
                        Approve changes
                      </SubmitButton>
                    )}
                  </div>
                </form>
              )}

              {status === "draft" && (
                <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-low">
                  This card is not signed yet, so it cannot be approved. If the
                  turn paused, continue it to finish the proposal; a draft
                  expires after six hours.
                </p>
              )}

              {status === "approved" && (
                <div className="space-y-2 border-t border-line pt-3">
                  {changeset.pr_url && typeof changeset.pr_number === "number" ? (
                    <p className="text-[11px] leading-relaxed text-mid">
                      Committed on{" "}
                      <span className="font-mono text-body">{changeset.branch_name}</span>.{" "}
                      <a
                        href={changeset.pr_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-text underline-offset-2 hover:underline"
                      >
                        Pull request #{changeset.pr_number}
                      </a>{" "}
                      The default branch was not modified.
                    </p>
                  ) : (
                    <>
                      <p className="text-[11px] leading-relaxed text-mid">
                        {directCommit
                          ? "Approved, but GitHub has not confirmed the commit yet."
                          : "Approved, but GitHub has not confirmed a pull request yet."}
                      </p>

                      {changeset.failure && (
                        <p
                          role="alert"
                          className="rounded-2xl border border-danger/25 bg-danger/8 px-4 py-2.5 text-[11px] leading-relaxed text-danger"
                        >
                          {changeset.failure}
                        </p>
                      )}

                      <form
                        action={approveProposal}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <input type="hidden" name="changesetId" value={changeset.id} />
                        <input type="hidden" name="chatId" value={chatId} />
                        <input
                          type="hidden"
                          name="target"
                          value={directCommit ? "branch" : "pr"}
                        />
                        {directCommit && changeset.branch_name && (
                          <input
                            type="hidden"
                            name="branch"
                            value={changeset.branch_name}
                          />
                        )}

                        <p className="max-w-md text-[11px] leading-relaxed text-low">
                          Retry reuses{" "}
                          {changeset.branch_name
                            ? `the branch ${changeset.branch_name}`
                            : "the same branch"}{" "}
                          and any commit already created; it never opens a second
                          pull request or a second commit.
                        </p>

                        <SubmitButton
                          className="btn px-4 py-1.5 text-[11.5px]"
                          pendingText="Retrying…"
                        >
                          Retry approval
                        </SubmitButton>
                      </form>
                    </>
                  )}
                </div>
              )}

              {status === "expired" && (
                <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-warn">
                  Expired after six hours. Ask again for a fresh proposal; this
                  one can no longer be approved.
                </p>
              )}

              {status === "failed" && (
                <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-danger">
                  No file could be proposed. The errors above say why; nothing was
                  stored as ready.
                </p>
              )}

              {status === "committed" && (
                <p className="border-t border-line pt-3 text-[11px] leading-relaxed text-mid">
                  Committed on{" "}
                  <span className="font-mono text-body">
                    {changeset.branch_name ?? "an agent branch"}
                  </span>
                  {changeset.commit_sha ? (
                    <>
                      {" "}at{" "}
                      <span className="font-mono text-body">
                        {changeset.commit_sha.slice(0, 7)}
                      </span>
                    </>
                  ) : null}
                  .{" "}
                  {changeset.pr_url && typeof changeset.pr_number === "number" ? (
                    <>
                      <a
                        href={changeset.pr_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-text underline-offset-2 hover:underline"
                      >
                        Pull request #{changeset.pr_number}
                      </a>{" "}
                      The default branch was not modified.
                    </>
                  ) : (
                    "No pull request was opened; this was a direct commit to the branch above."
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
