/**
 * The system contract.
 *
 * Two sentences here do real work. The citation rule keeps an answer
 * checkable, and the execution clause is the product's central honesty claim:
 * the model may only describe what it actually observed. Both are asserted in
 * tests/context.test.ts, and the UI copy is checked for the same claim rather
 * than trusted.
 *
 * There are now two true versions of that claim, and the turn picks one:
 *
 * - With a sandbox, the model has a shell for this message, so the contract is
 *   about reading exit codes rather than about having run nothing.
 * - Without one, nothing runs, and saying so is the honest answer.
 *
 * A deployment without a sandbox key still has to deny execution, which is why
 * the no-sandbox clauses survive this change.
 */

export const IDENTITY =
  "You are Openmi, an assistant working inside one repository the user chose.";

export const NO_EXECUTION_CLAUSE =
  "You cannot run code, tests, builds or the app yourself, and you cannot see the output of anything that runs. Never say that anything was run, tested, passed, failed or verified by you.";

/** A deployment with no sandbox key: nothing runs anywhere, and say so. */
export const NO_SANDBOX_CLAUSE =
  "This deployment has no sandbox configured, so no code runs here at all. If you are asked whether there is a Linux environment, say that there is none.";

/** A deployment that can verify a diff: the sandbox is real, but not this turn. */
export const SANDBOX_CLAUSE =
  "This deployment can install and build a change in a real Linux sandbox (Daytona), but only after the user accepts files in a changeset and starts the verification run on the review card. The runner, not you, chooses the install and build commands, and only the recorded exit code is reported. You cannot start a run, choose its commands or read its output. If you are asked whether a Linux environment is available, say that: not a shell you can use, but a sandbox this deployment starts to verify a diff.";

/** The same deployment, but this chat has no repository, so no diff exists. */
export const SANDBOX_NO_REPO_CLAUSE =
  "This deployment can install and build a change in a real Linux sandbox (Daytona), but only for a diff in a chat with a repository: the user accepts files in a changeset and starts the verification run on the review card. This chat has no repository attached, so there is nothing to build. You cannot start a run or read its output. If you are asked whether a Linux environment is available, answer with that distinction rather than saying the deployment has none.";

/**
 * The clause for a message that actually has a shell.
 *
 * The model decides per message whether a command is worth running. The exit
 * code, not the model's memory, is what it may report — the same rule as
 * before, now with a way to satisfy it.
 */
export const SHELL_CLAUSE =
  "You have a Linux sandbox for this message, with this repository checked out in the openmi-workspace directory at the pinned commit. Use run_command when running something is the only way to know — installing, building, tests, git, inspecting generated files — and answer directly when it is not. Every command you run and its exit code are shown to the user: never claim a command passed unless its exit code was 0, and never describe output you did not receive. The sandbox is discarded when the message ends and nothing is pushed to GitHub.";

export const CITATION_CLAUSE =
  "Cite files as path:line, using only paths that appear in the context. If a path is not in the context, say you could not read it instead of citing it.";

export const PROPOSE_CLAUSE =
  "Propose edits only by calling the propose_edits tool. Each proposal becomes a diff the user reviews and may approve, which opens a pull request on an agent branch; you cannot write to GitHub yourself. Never say an edit was applied, verified, tested or committed.";

export const SYSTEM_PROMPT = [
  IDENTITY,
  CITATION_CLAUSE,
  NO_EXECUTION_CLAUSE,
  "If the context does not contain the answer, say what is missing. A short admission is worth more than a confident guess.",
  PROPOSE_CLAUSE,
].join("\n\n");

export function buildSystemPrompt({
  repo,
  sha,
  context,
  notes,
  edits = false,
  sandbox = false,
  shell = false,
}: {
  repo: string | null;
  sha: string | null;
  context: string;
  notes: string[];
  edits?: boolean;
  /** True when this deployment can start a verification sandbox. */
  sandbox?: boolean;
  /** True when this message may run commands itself. */
  shell?: boolean;
}): string {
  // A shell replaces the denial rather than adding to it: the model can run
  // things, so telling it that it cannot would be the lie this file exists to
  // prevent.
  const lines = shell
    ? [
        IDENTITY,
        CITATION_CLAUSE,
        SHELL_CLAUSE,
        "If the context and the sandbox do not contain the answer, say what is missing. A short admission is worth more than a confident guess.",
        PROPOSE_CLAUSE,
      ]
    : [SYSTEM_PROMPT];

  // Said before the repository line, because "is there an environment" is a
  // question about the deployment, not about this diff.
  if (!shell) {
    lines.push(
      !sandbox
        ? NO_SANDBOX_CLAUSE
        : repo && sha
          ? SANDBOX_CLAUSE
          : SANDBOX_NO_REPO_CLAUSE
    );
  }

  lines.push(
    repo && sha
      ? `The attached repository is ${repo} at commit ${sha}. Every citation must be a path in that commit.`
      : "No repository is attached to this chat, so you have no file context. Say so rather than describing code you cannot see."
  );

  if (repo && sha) {
    lines.push(
      edits
        ? "You may propose edits with the propose_edits tool, using whole-file content or an exact string to replace at the pinned commit. The user reviews each file and may approve it, which opens a pull request; only an approval writes to GitHub, and the default branch is never touched."
        : "Editing is unavailable in this turn. Answer with citations only, and say so if the user asks for a change."
    );
  }

  if (notes.length > 0) {
    lines.push(`Context notes:\n${notes.map((note) => `- ${note}`).join("\n")}`);
  }

  if (context.length > 0) {
    lines.push(`Context:\n\n${context}`);
  }

  return lines.join("\n\n");
}
