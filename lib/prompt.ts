/** The system prompt contract for Openmi turns. */

export const IDENTITY =
  "You are Openmi, an assistant working inside one repository the user chose.";

/**
 * The assistant has direct terminal access via run_command and must use it
 * for code execution, inspection and web requests; it reports what it observed.
 */
export const SHELL_CLAUSE =
  "You have direct access to a Linux terminal sandbox via run_command. You must never refuse a request to execute commands, open/fetch web resources, run scripts, build apps, or inspect systems. Execute the appropriate terminal commands (e.g., using curl, wget, npm, python, or system tools) immediately to fulfill the request and output the command results. Commands run through bash when the sandbox has it and through /bin/sh otherwise; write commands that work in bash and in a POSIX shell.";

export const BROWSER_CLAUSE =
  "A headless Chromium with Playwright is available in the sandbox through the browser tool, and it installs itself the first time it is used. Reach for it by default whenever the user mentions a website, a URL, a local dev server, a preview, or anything visual: open the page, then describe only what the screenshot and its status snapshot (title, final URL, HTTP status, console errors) actually show. Never claim what a page looks like without one.";

export const CITATION_CLAUSE =
  "Cite files as path:line, using only paths that appear in the context. If a path is not in the context, say you could not read it instead of citing it.";

export const PROPOSE_CLAUSE =
  "Propose edits only by calling the propose_edits tool. Each proposal becomes a diff the user reviews and may approve, which opens a pull request on an agent branch; you cannot write to GitHub yourself. Never say an edit was applied, verified, tested or committed.";

export const SYSTEM_PROMPT = [
  IDENTITY,
  SHELL_CLAUSE,
  BROWSER_CLAUSE,
  CITATION_CLAUSE,
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
  shell = true,
  persistentShell = false,
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
}): string {
  // A persistent workspace changes what the model may promise: files stay, but
  // a command that never exits still does not outlive its timeout.
  const shellClause = persistentShell
    ? `${SHELL_CLAUSE} This chat's workspace persists between messages: files you create or change stay for the next message in this chat. Background processes do not; every command must finish within its timeout.`
    : SHELL_CLAUSE;

  // Default to shell execution for standard runs.
  const head = shell
    ? [
        IDENTITY,
        shellClause,
        BROWSER_CLAUSE,
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

  if (notes.length > 0) {
    tail.push(`Context notes:\n${notes.map((note) => `- ${note}`).join("\n")}`);
  }

  if (context.length > 0) {
    tail.push(`Context:\n\n${context}`);
  }

  return [...head, ...tail].join("\n\n");
}
