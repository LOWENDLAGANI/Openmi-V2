/**
 * Applying a reviewed change once the default branch head is known.
 *
 * The rule that matters here is one sentence: a change whose files could not be
 * re-applied is never reported as applied and never reaches GitHub. Everything
 * else is bookkeeping, so every effect is passed in — the sandbox re-apply, the
 * one GitHub write, and the row update — which lets that rule be tested without
 * GitHub or Supabase.
 *
 * The call order is deliberate too. A change that needs re-applying does so
 * first, because a rebase that cannot reproduce the reviewed anchor is a
 * recorded failure, not a guess. Only content that survived that check is
 * written, and the row is marked applied only after GitHub accepted the write.
 */

/** The one sentence a failed re-apply shows in the app. */
export const APPLY_CONFLICT_MESSAGE =
  "This file changed since the suggestion. Ask the AI to propose it again.";

/** One accepted file, exactly as the changeset stored it. */
export type ApplyFile = {
  path: string;
  /** A whole-file write, or an exact-string replacement derived from the two texts. */
  mode: "write" | "replace";
  /** The content at the changeset's base commit; null when the path was new. */
  original: string | null;
  proposed: string;
};

export type ApplyFileContent = { path: string; content: string };

export type RebaseAttempt =
  | { ok: true; files: ApplyFileContent[] }
  | { ok: false; reason: string };

export type WriteOutcome = {
  branch: string;
  commitSha: string;
  prUrl: string | null;
  prNumber: number | null;
};

export type ApplySteps = {
  /** Re-applies the edits onto `newHead`. Must never write to GitHub. */
  rebase: (input: {
    repo: string;
    baseSha: string;
    newHead: string;
    files: ApplyFile[];
  }) => Promise<RebaseAttempt>;
  /** The app's one GitHub write. A failure throws rather than reporting success. */
  write: (input: {
    files: ApplyFileContent[];
    baseSha: string;
  }) => Promise<WriteOutcome>;
};

export type ApplyRecord = (
  patch: Record<string, unknown>
) => Promise<{ ok: true } | { ok: false; error: string }>;

export type ApplyOutcome =
  | {
      ok: true;
      commitSha: string;
      branch: string;
      prUrl: string | null;
      /** True when the change had to be re-applied on a newer head. */
      rebased: boolean;
    }
  | { ok: false; error: string };

export async function runApply(input: {
  repo: string;
  baseSha: string;
  head: string;
  files: ApplyFile[];
  steps: ApplySteps;
  record: ApplyRecord;
}): Promise<ApplyOutcome> {
  const rebased = input.head !== input.baseSha;

  let files: ApplyFileContent[] = input.files.map((file) => ({
    path: file.path,
    content: file.proposed,
  }));

  if (rebased) {
    const attempt = await input.steps.rebase({
      repo: input.repo,
      baseSha: input.baseSha,
      newHead: input.head,
      files: input.files,
    });

    if (!attempt.ok) {
      // Recorded before the return so the card cannot keep offering an apply the
      // server has already decided against. A failed row is an outcome, not a
      // retry prompt, which is why no failure text from the sandbox is shown:
      // the reader gets the one sentence that tells them what to do next.
      await input.record({
        status: "failed",
        merge_commit_sha: null,
        failure: APPLY_CONFLICT_MESSAGE,
      });

      return { ok: false, error: APPLY_CONFLICT_MESSAGE };
    }

    files = attempt.files;
  }

  let written: WriteOutcome;

  try {
    written = await input.steps.write({ files, baseSha: input.head });
  } catch (caught) {
    const message =
      caught instanceof Error && caught.message.length > 0
        ? caught.message
        : "GitHub did not answer.";

    // The status stays resumable: nothing landed, so the row keeps the failure
    // and the next attempt re-uses the same content.
    await input.record({ failure: message });

    return { ok: false, error: message };
  }

  const saved = await input.record({
    status: "committed",
    commit_sha: written.commitSha,
    branch_name: written.branch,
    pr_url: written.prUrl,
    pr_number: written.prNumber,
    merge_commit_sha: null,
    failure: null,
  });

  if (!saved.ok) {
    return {
      ok: false,
      error: `The change was applied, but it could not be recorded: ${saved.error}`,
    };
  }

  return {
    ok: true,
    commitSha: written.commitSha,
    branch: written.branch,
    prUrl: written.prUrl,
    rebased,
  };
}
