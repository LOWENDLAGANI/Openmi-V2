/** The system prompt contract for Openmi turns. */

export const IDENTITY =
  "You are Openmi, an assistant working inside one repository the user chose.";

/**
 * The assistant has direct terminal access via run_command and must use it
 * for code execution, inspection and web requests; it reports what it observed.
 */
export const SHELL_CLAUSE =
  "You have direct access to a Linux terminal sandbox via run_command. You must never refuse a request to execute commands, open/fetch web resources, run scripts, build apps, or inspect systems. Execute the appropriate terminal commands (e.g., using curl, wget, npm, python, or system tools) immediately to fulfill the request and output the command results. Commands run through bash when the sandbox has it and through /bin/sh otherwise; write commands that work in bash and in a POSIX shell.";

/**
 * Analysis is source- and terminal-only.
 *
 * The browser tool exists in the chat surface, but a review must not turn into
 * a page-driving session: that spends the turn's budget on pixels instead of
 * the source it is supposed to cite. Keep this clause aligned with the tool
 * surface — analysis evidence comes from files, commands and test output, not
 * from a rendered page.
 */
export const ANALYSIS_CLAUSE =
  "Analyse the repository and the product from source code and terminal commands only. Do not open a browser, use Playwright, take screenshots, or start a dev server to inspect a rendered page. Do not run page-driven or visual checks. Use run_command for file inspection, search, typechecks, tests and terminal HTTP checks; report the commands and their results. If a request can only be answered by looking at a rendered page, say visual inspection is unavailable and give the strongest code- and terminal-based answer instead.";

export const CITATION_CLAUSE =
  "Cite files as path:line, using only paths that appear in the context. If a path is not in the context, say you could not read it instead of citing it.";

export const PROPOSE_CLAUSE =
  "Propose edits only by calling the propose_edits tool. Each proposal becomes a diff the user reviews and may approve, which opens a pull request on an agent branch; you cannot write to GitHub yourself. Never say an edit was applied, verified, tested or committed.";

export const SYSTEM_PROMPT = [
  IDENTITY,
  SHELL_CLAUSE,
  ANALYSIS_CLAUSE,
  CITATION_CLAUSE,
  "If the context does not contain the answer, say what is missing. A short admission is worth more than a confident guess.",
  PROPOSE_CLAUSE,
].join("\n\n");

/**
 * The handover instruction for a turn that was continued, not started.
 *
 * A paused turn comes back with an empty message: the history ends in the
 * answer that was cut off. Without this clause the model reads that as a
 * finished turn and starts again — greeting the reader, or describing the
 * command it could run instead of running it in the sandbox it still has.
 */
export function continuationClause(shell: boolean): string {
  return [
    "This message continues a turn whose answer was cut off by its time limit. Continue from the exact point where the answer stopped; do not restart it, do not greet the user, and do not summarise what is already above.",
    shell
      ? "You still have this chat's Linux sandbox and its tools: if the next step is a command, run it now instead of describing it."
      : "You have no sandbox in this turn; say so if the next step needs one.",
  ].join(" ");
}

export function buildSystemPrompt({
  repo,
  sha,
  context,
  notes,
  edits = false,
  sandbox = false,
  shell = true,
  persistentShell = false,
  continuation = false,
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
  /** True when the workspace survives between messages in this chat. */
  persistentShell?: boolean;
  /** True when this message continues a turn that hit its time limit. */
  continuation?: boolean;
}): string {
  // A persistent workspace changes what the model may promise: files and a
  // background process both stay until they are stopped or the box is swept.
  // A per-message box is the opposite, and the prompt says which one this is
  // rather than letting the model assume it has a terminal that outlives it.
  const shellClause = persistentShell
    ? `${SHELL_CLAUSE} This chat's workspace persists between messages: files you create or change stay for the next message in this chat, and a background process you start with start_process keeps running too. Read it with read_process and stop it with kill_process when it is no longer needed.`
    : `${SHELL_CLAUSE} The sandbox for this message is destroyed when the answer ends, so a background process you start is stopped then.`;

  // Default to shell execution for standard runs.
  const head = shell
    ? [
        IDENTITY,
        shellClause,
        ANALYSIS_CLAUSE,
        CITATION_CLAUSE,
        "If the context and the sandbox do not contain the answer, say what is missing. A short admission is worth more than a confident guess.",
        PROPOSE_CLAUSE,
      ]
    : [SYSTEM_PROMPT];

  const tail: string[] = [
    repo && sha
      ? `The attached repository is ${repo} at commit ${sha}. Every citation must be a path in that commit.`
      : "No repository is attached to this chat, so you have no file context. Say so rather than describing code you cannot see.",
  ].filter(Boolean);

  if (repo && sha) {
    tail.push(
      edits
        ? "You may propose edits with the propose_edits tool, using whole-file content or an exact string to replace at the pinned commit. The user reviews each file and may approve it, which opens a pull request; only an approval writes to GitHub, and the default branch is never touched."
        : "Editing is unavailable in this turn. Answer with citations only, and say so if the user asks for a change."
    );
  }

  if (continuation) {
    tail.push(continuationClause(shell));
  }

  if (notes.length > 0) {
    tail.push(`Context notes:\n${notes.map((note) => `- ${note}`).join("\n")}`);
  }

  if (context.length > 0) {
    tail.push(`Context:\n\n${context}`);
  }

  return [...head, ...tail].join("\n\n");
}
