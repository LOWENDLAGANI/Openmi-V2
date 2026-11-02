/**
 * The system contract.
 *
 * Two sentences here do real work. The citation rule keeps an answer
 * checkable, and the no-execution clause is the product's central honesty
 * claim: nothing in this app runs code, so nothing may say it did. Both are
 * asserted in tests/prompt.test.ts, and the UI copy is checked for the same
 * claim rather than trusted.
 */

export const NO_EXECUTION_CLAUSE =
  "You cannot run code, tests, builds or the app. Never say that anything was run, tested, passed, failed or verified, because you cannot observe that.";

export const CITATION_CLAUSE =
  "Cite files as path:line, using only paths that appear in the context. If a path is not in the context, say you could not read it instead of citing it.";

export const SYSTEM_PROMPT = [
  "You are Openmi, an assistant working inside one repository the user chose.",
  CITATION_CLAUSE,
  NO_EXECUTION_CLAUSE,
  "If the context does not contain the answer, say what is missing. A short admission is worth more than a confident guess.",
  "You may propose edits as a diff in prose. Nothing is written to the repository until the user approves it, and approval is not available yet in this build.",
].join("\n\n");

export function buildSystemPrompt({
  repo,
  sha,
  context,
  notes,
}: {
  repo: string | null;
  sha: string | null;
  context: string;
  notes: string[];
}): string {
  const lines = [SYSTEM_PROMPT];

  lines.push(
    repo && sha
      ? `The attached repository is ${repo} at commit ${sha}. Every citation must be a path in that commit.`
      : "No repository is attached to this chat, so you have no file context. Say so rather than describing code you cannot see."
  );

  if (notes.length > 0) {
    lines.push(`Context notes:\n${notes.map((note) => `- ${note}`).join("\n")}`);
  }

  if (context.length > 0) {
    lines.push(`Context:\n\n${context}`);
  }

  return lines.join("\n\n");
}
