/**
 * The branch a reader asked for, read from their own sentence.
 *
 * The default destination is one new `openmi/agent/` branch and a pull request,
 * because most requests are "change this" and a review is the safe place for a
 * diff to land. But "push it to main" is a request for a destination, and an
 * app that silently demotes it to a pull request is answering a different
 * question. The reader naming a branch is the permission to write that branch —
 * the default branch included — so the write client is told the reader asked.
 *
 * Read conservatively: a write verb is required, a branch is only taken when it
 * is the default branch, is written as `` `a/branch` ``, is followed by the
 * word "branch", or is a bare name with no file extension. "Read main.ts" and
 * "open a pull request to main" both come back null, because a pull request
 * names its base, not its destination.
 *
 * Pure on purpose: testable without a request context or a network call.
 */

/** Words a "to X" phrase lands on that are never a branch. */
const STOP_WORDS = new Set([
  "it",
  "them",
  "the",
  "a",
  "an",
  "that",
  "this",
  "there",
  "repo",
  "repository",
  "github",
  "your",
  "my",
  "our",
  "branch",
  "commit",
  "pull",
  "request",
  "pr",
  "git",
  "remote",
  "origin",
]);

/** "push to main", "commit straight to the develop branch", "land this in `release/2.0`". */
const PHRASE =
  /\b(?:push|commit|write|apply|land|merge|send|deploy|ship)\b[^\n]{0,80}?\b(?:to|into|onto|in)\s+(?:the\s+)?`?([A-Za-z0-9][\w./-]{0,99})`?(\s+branch\b)?/i;

const PR_ONLY = /\b(?:pull request|pull-request|\bpr\b)\b/i;

function isBranchish(token: string): boolean {
  const lower = token.toLowerCase();

  if (STOP_WORDS.has(lower)) return false;
  // A path or a host is not a branch. `release/1.0` has a slash without a
  // scheme, so the colon is what disqualifies an address.
  if (lower.includes(":") || lower.includes("..")) return false;
  return true;
}

/**
 * The branch this message asks to write to, or null for the default path.
 *
 * `defaultBranch` is the repository's own default, so "push to main" is
 * recognised even when the phrase says nothing about branches.
 */
export function requestedBranch(
  message: string,
  defaultBranch: string | null
): string | null {
  const text = message.replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;

  const match = text.match(PHRASE);
  if (!match) return null;

  const token = match[1].trim();
  const saysBranch = Boolean(match[2]);

  if (!isBranchish(token)) return null;

  // "push to https://…" stops at the scheme: whatever follows the token is
  // an address, not a branch.
  const after = text.slice((match.index ?? 0) + match[0].length);
  if (after.startsWith(":") || after.startsWith("@")) return null;

  const isDefault =
    defaultBranch !== null &&
    token.toLowerCase() === defaultBranch.trim().toLowerCase();

  // A bare word is only a branch when it has no extension, names the default
  // branch, or the sentence called it a branch. "push to production" is
  // accepted; "push to main.ts" is not.
  const branchish =
    isDefault || saysBranch || !token.includes(".") || token.includes("/");

  if (!branchish) return null;

  // "open a pull request to main" names a base, not a destination.
  if (isDefault && PR_ONLY.test(text)) return null;

  return token;
}
