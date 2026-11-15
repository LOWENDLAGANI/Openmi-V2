/**
 * Where a turn's change is written, as the model declared it.
 *
 * The reader says where in their own sentence — "push it to main", "open a PR",
 * "just give me a branch" — and the model turns that into one of three kinds
 * with the `publish` tool. This module turns the kind into the write the
 * changeset layer performs. Pure, so the mapping is testable without a
 * repository, a token or a database.
 */

export type PublishKind = "default-branch" | "new-branch" | "pull-request";

export type PublishDestination = {
  kind: PublishKind;
  /** The branch the reader named, for `new-branch`. Null when they named none. */
  branch?: string | null;
};

export type WritePlan = {
  /** What was asked for, in one word. `auto` means the reader said nothing. */
  target: PublishKind | "auto";
  /** The ref the commit lands on. */
  branch: string;
  /** Set when the commit goes straight to a branch instead of opening a PR. */
  targetBranch?: string;
  /** True only for a destination the reader named. */
  allowDefaultBranch: boolean;
  /**
   * False for "leave it on a branch" and "open a pull request": the change is
   * written but not merged, because merging is not what was asked for.
   */
  merge: boolean;
};

/**
 * The write a destination implies.
 *
 * `auto` keeps the ordinary path: a derived `openmi/agent/` branch, one pull
 * request, merged, because that is where a change lands when nobody said where.
 * Every other kind is the reader's own choice and is followed literally, except
 * the one contradiction — asking for a "new branch" that is the default branch —
 * which is refused rather than silently rewritten.
 */
export function planWrite(input: {
  destination: PublishDestination | null;
  agentBranch: string;
  defaultBranch: string;
}): { ok: true; plan: WritePlan } | { ok: false; error: string } {
  const { destination, agentBranch, defaultBranch } = input;

  if (!destination) {
    return {
      ok: true,
      plan: {
        target: "auto",
        branch: agentBranch,
        allowDefaultBranch: false,
        merge: true,
      },
    };
  }

  if (destination.kind === "default-branch") {
    return {
      ok: true,
      plan: {
        target: "default-branch",
        branch: defaultBranch,
        targetBranch: defaultBranch,
        allowDefaultBranch: true,
        merge: false,
      },
    };
  }

  if (destination.kind === "new-branch") {
    const branch = destination.branch?.trim() || agentBranch;

    if (branch === defaultBranch) {
      return {
        ok: false,
        error: `"${defaultBranch}" is the default branch. Use the default-branch destination to write it, or pull-request to propose the change instead.`,
      };
    }

    return {
      ok: true,
      plan: {
        target: "new-branch",
        branch,
        targetBranch: branch,
        allowDefaultBranch: false,
        merge: false,
      },
    };
  }

  // A pull request names its base, not its head: the head is the agent branch and
  // the merge is left to GitHub, so nothing lands on the default branch here.
  return {
    ok: true,
    plan: {
      target: "pull-request",
      branch: agentBranch,
      allowDefaultBranch: false,
      merge: false,
    },
  };
}
