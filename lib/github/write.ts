import {
  AGENT_BRANCH_PATTERN,
  AGENT_BRANCH_PREFIX,
  agentBranchName,
  isSafeBranchName,
} from "@/lib/branch";
import { deriveReplacement, replaceOnce } from "@/lib/changesets/replacement";
import { GITHUB_API, GITHUB_TIMEOUT_MS, isRepoFullName } from "./read";

export { AGENT_BRANCH_PREFIX, agentBranchName } from "@/lib/branch";

/**
 * The only module in the app that writes to GitHub.
 *
 * The safety property is structural, not a prompt instruction. A pull request
 * always goes to a branch derived from the changeset id, and every write on
 * that path goes through `assertAgentBranch` first. A change the reader sends to
 * a named branch keeps that name only when it passes git's own rules and is not
 * the repository's default branch: the default branch is never written, so
 * naming it means "give this change its own branch" (an operator can opt into
 * direct default-branch writes with `OPENMI_ALLOW_DEFAULT_BRANCH`). A named
 * branch that has moved since the diff was computed is not a dead end either —
 * the change goes to a new branch on top of the live head. Nothing is forced.
 * tests/github-read.test.ts keeps read-only modules GET-only and
 * tests/github-write.test.ts pins these rules and the request shapes.
 *
 * One approval means one commit and either one agent branch with a pull request
 * or one direct branch update. The changeset id is the idempotency key: the
 * agent branch name contains it, the commit is content-addressed by GitHub, and
 * an existing pull request is reused rather than duplicated on retry.
 *
 * An approval then applies itself. `mergeProposal` waits for GitHub to finish
 * computing mergeability, re-applies the same edits on top of the live default
 * head when the suggestion is dirty, and squash-merges. A suggestion that can no
 * longer be re-applied is closed and its branch removed rather than left as a
 * half-applied pull request. `revertChangeset` is the undo: it restores the
 * changed files to their content at the changeset's base and moves the default
 * branch to that revert commit, without forcing the ref.
 *
 * The PR body states that nothing was executed. That is the product's central
 * honesty claim and it travels with the diff, not just the UI.
 */

export const MAX_COMMIT_FILES = 24;
export const MAX_COMMIT_FILE_BYTES = 120_000;

export type GithubWriteFailure =
  | "refused"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "unavailable";

export class GithubWriteError extends Error {
  readonly failure: GithubWriteFailure;
  readonly status: number;

  constructor(failure: GithubWriteFailure, message: string, status = 0) {
    super(message);
    this.name = "GithubWriteError";
    this.failure = failure;
    this.status = status;
  }
}

export function describeWriteError(error: unknown): string {
  if (error instanceof GithubWriteError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "GitHub did not answer.";
}

export type ProposedFile = { path: string; content: string };

export type CommitOutcome = {
  branch: string;
  baseBranch: string;
  commitSha: string;
  /** Null for a direct commit: no pull request was opened. */
  prUrl: string | null;
  prNumber: number | null;
};

/**
 * Throws unless this is an Openmi agent branch and not the repository's default
 * branch. A default branch name, a user-supplied branch and a malformed name
 * all get the same refusal, because none of them is a thing this app commits.
 */
export function assertAgentBranch(branch: string, defaultBranch: string): void {
  if (branch === defaultBranch || !AGENT_BRANCH_PATTERN.test(branch)) {
    throw new GithubWriteError(
      "refused",
      "Openmi only commits to agent/ branches.",
      403
    );
  }
}

/** A direct commit names its branch, so the name is checked before any write. */
export function assertSafeBranch(branch: string): void {
  if (!isSafeBranchName(branch)) {
    throw new GithubWriteError(
      "refused",
      `"${branch}" is not a valid branch name to commit to.`,
      403
    );
  }
}

/** A branch path keeps its slashes; every other character is encoded. */
function encodedBranch(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/");
}

/** A repository path keeps its slashes; every other segment is encoded. */
function encodedPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

/** The head of a branch, or null when GitHub says it does not exist. */
async function readBranchHead(
  token: string,
  repoPath: string,
  branch: string
): Promise<string | null> {
  try {
    const ref = await request<{ object: { sha: string } }>(
      token,
      "GET",
      `${repoPath}/git/ref/heads/${encodedBranch(branch)}`
    );

    return ref.object.sha;
  } catch (caught) {
    if (caught instanceof GithubWriteError && caught.failure === "not-found") {
      return null;
    }
    throw caught;
  }
}

/** The PR base is the repository's default branch, read live from GitHub. */
export function assertBaseBranch(baseBranch: string, defaultBranch: string): void {
  if (baseBranch !== defaultBranch) {
    throw new GithubWriteError(
      "refused",
      `This chat is pinned to "${baseBranch}", but the repository's default branch is "${defaultBranch}". Nothing was opened.`,
      403
    );
  }
}

type WriteMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

function safeCommitPath(path: string): boolean {
  if (path.length === 0 || path.length > 400) return false;
  if (path.startsWith("/") || path.includes("..") || path.includes("\\")) return false;
  if (path.includes("://")) return false;
  return path !== ".git" && !path.startsWith(".git/");
}

async function request<T>(
  token: string,
  method: WriteMethod,
  path: string,
  body?: unknown
): Promise<T> {
  const url = path.startsWith("https://") ? path : `${GITHUB_API}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "openmi",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch {
    throw new GithubWriteError(
      "unavailable",
      "GitHub did not answer within 15 seconds. Nothing beyond what GitHub already accepted was changed.",
      0
    );
  }

  if (response.ok) {
    // A ref deletion answers 204 with no body; there is nothing to parse.
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  if (response.status === 401) {
    throw new GithubWriteError(
      "unauthorized",
      "GitHub rejected the token. Reconnect with one that can write to this repository.",
      401
    );
  }

  if (response.status === 403) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      throw new GithubWriteError(
        "unavailable",
        "GitHub's rate limit is exhausted. Nothing was committed; wait a minute and retry.",
        403
      );
    }

    throw new GithubWriteError(
      "forbidden",
      "GitHub refused the write. The token needs Contents: read and write, and Pull requests: read and write.",
      403
    );
  }

  if (response.status === 404) {
    throw new GithubWriteError(
      "not-found",
      "GitHub returned 404. The repository, base commit or branch is not readable with this token.",
      404
    );
  }

  if (response.status === 405 || response.status === 409) {
    throw new GithubWriteError(
      "conflict",
      "GitHub refused the change because the code moved or the request is not allowed right now.",
      response.status
    );
  }

  if (response.status === 422) {
    throw new GithubWriteError(
      "conflict",
      "GitHub rejected the request as a conflict.",
      422
    );
  }

  throw new GithubWriteError(
    "unavailable",
    `GitHub returned ${response.status}.`,
    response.status
  );
}

/**
 * One branch, one commit, one pull request.
 *
 * Progress is reported through `onProgress` so the caller can persist the
 * branch and commit before the PR call; a failure after a partial write is then
 * a resumable state rather than a mystery. A retry with the stored commit sha
 * skips tree and commit creation entirely.
 */
export async function commitProposal({
  token,
  repo,
  defaultBranch,
  baseBranch,
  baseSha,
  files,
  changesetId,
  existingCommitSha,
  targetBranch,
  allowDefaultBranch = false,
  onProgress,
}: {
  token: string;
  repo: string;
  defaultBranch: string;
  baseBranch: string;
  baseSha: string;
  files: ProposedFile[];
  changesetId: string;
  existingCommitSha?: string;
  /** When set, commit straight to this branch instead of opening a PR. */
  targetBranch?: string;
  /**
   * When true, naming the repository's default branch writes to it instead of
   * creating a new one. Off unless `OPENMI_ALLOW_DEFAULT_BRANCH` is set.
   */
  allowDefaultBranch?: boolean;
  onProgress?: (progress: { branch: string; commitSha?: string }) => Promise<void> | void;
}): Promise<CommitOutcome> {
  if (!isRepoFullName(repo)) {
    throw new GithubWriteError("refused", "That repository name is not valid.", 403);
  }

  if (files.length === 0) {
    throw new GithubWriteError("refused", "There is nothing to commit.", 403);
  }

  if (files.length > MAX_COMMIT_FILES) {
    throw new GithubWriteError(
      "refused",
      `A commit carries at most ${MAX_COMMIT_FILES} files.`,
      403
    );
  }

  for (const file of files) {
    if (!safeCommitPath(file.path)) {
      throw new GithubWriteError("refused", `That path is not safe to commit: ${file.path}`, 403);
    }
    if (Buffer.byteLength(file.content, "utf8") > MAX_COMMIT_FILE_BYTES) {
      throw new GithubWriteError(
        "refused",
        `${file.path} is over the ${MAX_COMMIT_FILE_BYTES.toLocaleString()} byte cap.`,
        403
      );
    }
  }

  // Policy before the first request. A pull request can only use the branch
  // derived from this changeset, based on the repository default. A change may
  // name a branch instead. The default branch is normally not written — Openmi
  // edits on a branch of its own, so naming it means "make a new one" — unless
  // the operator has allowed default-branch writes and this change named it. A
  // named agent branch is a pull-request path either way, because a branch with
  // no PR would be a half-finished approval.
  let direct = targetBranch !== undefined;
  let branch = direct
    ? (targetBranch ?? "").trim()
    : agentBranchName(changesetId);

  if (direct && branch === defaultBranch && !allowDefaultBranch) {
    direct = false;
    branch = agentBranchName(changesetId);
  } else if (direct && branch.startsWith(AGENT_BRANCH_PREFIX)) {
    direct = false;
  }

  if (direct) {
    assertSafeBranch(branch);
  } else {
    assertAgentBranch(branch, defaultBranch);
    assertBaseBranch(baseBranch, defaultBranch);
  }

  const [owner, name] = repo.split("/");
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  await onProgress?.({ branch });

  // The named branch is read before anything is written. A branch that is no
  // longer at the pinned base has moved, so the change is given its own branch
  // on top of the live head instead of failing the approval or overwriting it.
  // The reviewed content still lands, and the ref is never forced.
  let branchHead: string | null = null;
  let writeBase = baseSha;

  if (direct) {
    branchHead = await readBranchHead(token, repoPath, branch);

    if (
      branchHead !== null &&
      branchHead !== baseSha &&
      branchHead !== existingCommitSha
    ) {
      direct = false;
      branch = agentBranchName(changesetId);
      writeBase = branchHead;
      branchHead = null;

      await onProgress?.({ branch });
    }
  }

  let commitSha = existingCommitSha ?? "";

  if (commitSha.length === 0) {
    const baseCommit = await request<{ tree: { sha: string } }>(
      token,
      "GET",
      `${repoPath}/git/commits/${encodeURIComponent(writeBase)}`
    );

    const tree = await request<{ sha: string }>(token, "POST", `${repoPath}/git/trees`, {
      base_tree: baseCommit.tree.sha,
      tree: files.map((file) => ({
        path: file.path,
        mode: "100644",
        type: "blob",
        content: file.content,
      })),
    });

    const commit = await request<{ sha: string }>(token, "POST", `${repoPath}/git/commits`, {
      message: `Openmi: propose ${files.length} file(s)\n\nChangeset ${changesetId}, approved in the app. The default branch was not modified.`,
      tree: tree.sha,
      parents: [writeBase],
    });

    commitSha = commit.sha;
  }

  await onProgress?.({ branch, commitSha });

  if (direct) {
    if (branchHead !== commitSha) {
      if (branchHead === null) {
        await request(token, "POST", `${repoPath}/git/refs`, {
          ref: `refs/heads/${branch}`,
          sha: commitSha,
        });
      } else {
        // Not forced: GitHub itself refuses a non-fast-forward move.
        await request(token, "PATCH", `${repoPath}/git/refs/heads/${encodedBranch(branch)}`, {
          sha: commitSha,
          force: false,
        });
      }
    }

    return {
      branch,
      baseBranch: branch,
      commitSha,
      prUrl: null,
      prNumber: null,
    };
  }

  // Create the agent ref, or verify a ref that an earlier attempt created.
  // A 422 here is expected on retry, so the ref is read back and compared.
  let branchSha: string | null = null;

  try {
    const ref = await request<{ object: { sha: string } }>(
      token,
      "POST",
      `${repoPath}/git/refs`,
      { ref: `refs/heads/${branch}`, sha: commitSha }
    );
    branchSha = ref.object.sha;
  } catch (caught) {
    if (!(caught instanceof GithubWriteError) || caught.failure !== "conflict") throw caught;

    const existing = await request<{ object: { sha: string } }>(
      token,
      "GET",
      `${repoPath}/git/ref/heads/${branch}`
    );
    branchSha = existing.object.sha;
  }

  if (branchSha !== commitSha) {
    throw new GithubWriteError(
      "conflict",
      `The agent branch ${branch} already points at another commit. Nothing was opened; inspect that branch first.`,
      409
    );
  }

  const pull = await request<{ html_url: string; number: number }>(
    token,
    "POST",
    `${repoPath}/pulls`,
    {
      title: `Openmi: ${files.length} proposed file${files.length === 1 ? "" : "s"}`,
      head: branch,
      base: defaultBranch,
      body: [
        `This pull request was opened by Openmi after the signed changeset \`${changesetId}\` was approved.`,
        "",
        "**Files**",
        ...files.map((file) => `- \`${file.path}\``),
        "",
        "Openmi did not run code, tests or builds for this change. Nothing in this pull request was verified by execution.",
      ].join("\n"),
    }
  ).catch(async (caught) => {
    if (!(caught instanceof GithubWriteError) || caught.failure !== "conflict") throw caught;

    // GitHub returns 422 for a second open PR on the same head. Reuse the one
    // that exists instead of failing an otherwise complete approval.
    const open = await request<Array<{ html_url: string; number: number }>>(
      token,
      "GET",
      `${repoPath}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`
    );

    const found = open[0];
    if (!found) {
      throw new GithubWriteError(
        "conflict",
        "GitHub refused a second pull request and no open one was found. Check the repository before retrying.",
        409
      );
    }

    return found;
  });

  return {
    branch,
    baseBranch: defaultBranch,
    commitSha,
    prUrl: pull.html_url,
    prNumber: pull.number,
  };
}

// ── Applying a proposal ──────────────────────────────────────────────────────
//
// An approval no longer stops at a pull request. After the PR exists, GitHub
// needs a moment to compute mergeability; when the default branch has moved the
// same edits are re-applied on top of the live head, and then the change is
// squash-merged. Everything below is still a write, so it lives in this module.

export const MERGE_POLL_ATTEMPTS = 5;
export const MERGE_POLL_INTERVAL_MS = 1_500;

/** The one sentence a re-apply failure shows in the app. */
export const CONFLICT_REAPPLY_MESSAGE =
  "This file changed since the suggestion. Ask the AI to propose the change again.";

/** Plain-language reason a merge could not finish; the PR is left alone. */
export const MERGE_UNAVAILABLE_MESSAGE =
  "This change could not be applied automatically because the code has moved. It was left for you to look at.";

/**
 * One changed file as the approval stored it.
 *
 * `original` is the content at the changeset's base commit, so a replacement
 * can be re-derived without storing the anchor twice. `mode` is what the
 * suggestion asked for: a whole-file write or one exact-string replacement.
 */
export type ChangedFile = {
  path: string;
  mode: "write" | "replace";
  original: string | null;
  proposed: string;
};

export type RevertFile = { path: string; original: string | null };

export type PullRequestMergeability = {
  number: number;
  htmlUrl: string;
  mergeable: boolean | null;
  mergeableState: string;
};

export type AutoMergeOutcome =
  | { ok: true; mergeCommitSha: string; reapplied: boolean }
  | { ok: false; error: string; pullRequestClosed: boolean };

type Sleep = (ms: number) => Promise<void>;

const sleepFor: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function repoPathOf(repo: string): string {
  if (!isRepoFullName(repo)) {
    throw new GithubWriteError("refused", "That repository name is not valid.", 403);
  }

  const [owner, name] = repo.split("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/**
 * The anchor derivation and the once-only substitution live in a pure module so
 * the approval, the re-apply and the sandbox rebase share one definition.
 * Re-exported here because this is where the write path has always imported it.
 */
export { deriveReplacement };

/** One text file at a commit, or null when it does not exist there. */
async function readFileAt(
  token: string,
  repoPath: string,
  sha: string,
  path: string
): Promise<string | null> {
  let data: { type?: string; encoding?: string; content?: string };

  try {
    data = await request<{ type?: string; encoding?: string; content?: string }>(
      token,
      "GET",
      `${repoPath}/contents/${encodedPath(path)}?ref=${encodeURIComponent(sha)}`
    );
  } catch (caught) {
    if (caught instanceof GithubWriteError && caught.failure === "not-found") {
      return null;
    }
    throw caught;
  }

  if (data.type !== "file" || data.encoding !== "base64" || typeof data.content !== "string") {
    throw new GithubWriteError(
      "conflict",
      `${path} is not a text file that can be re-applied.`,
      409
    );
  }

  return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function readPullRequest(
  token: string,
  repoPath: string,
  number: number
): Promise<PullRequestMergeability> {
  const body = await request<{
    number: number;
    html_url: string;
    mergeable: boolean | null;
    mergeable_state: string;
  }>(token, "GET", `${repoPath}/pulls/${number}`);

  return {
    number: body.number,
    htmlUrl: body.html_url,
    mergeable: body.mergeable ?? null,
    mergeableState: body.mergeable_state ?? "unknown",
  };
}

/**
 * Polls a pull request until GitHub has computed mergeability.
 *
 * GitHub answers `mergeable: null` for a moment after a push, so this reads up
 * to five times, 1.5 seconds apart, and returns the last observation either
 * way. `sleep` is injectable so tests do not wait.
 */
export async function waitForMergeable({
  token,
  repo,
  number,
  attempts = MERGE_POLL_ATTEMPTS,
  intervalMs = MERGE_POLL_INTERVAL_MS,
  sleep = sleepFor,
}: {
  token: string;
  repo: string;
  number: number;
  attempts?: number;
  intervalMs?: number;
  sleep?: Sleep;
}): Promise<PullRequestMergeability> {
  if (!Number.isInteger(number) || number <= 0) {
    throw new GithubWriteError("refused", "That change has no pull request to apply.", 403);
  }

  const repoPath = repoPathOf(repo);
  let state = await readPullRequest(token, repoPath, number);

  for (let poll = 1; poll < attempts; poll += 1) {
    if (typeof state.mergeable === "boolean") break;
    await sleep(intervalMs);
    state = await readPullRequest(token, repoPath, number);
  }

  return state;
}

/**
 * Re-applies every accepted edit on top of the live default head.
 *
 * Returns `ok: false` when a replacement anchor is missing or not unique, which
 * is the only case that closes the pull request. A GitHub failure throws, so the
 * caller records it without destroying the change.
 */
async function reapplyOnHead(input: {
  token: string;
  repoPath: string;
  branch: string;
  defaultBranch: string;
  changesetId: string;
  files: ChangedFile[];
}): Promise<{ ok: true } | { ok: false }> {
  const head = await readBranchHead(input.token, input.repoPath, input.defaultBranch);

  if (head === null) {
    throw new GithubWriteError(
      "not-found",
      "The repository's default branch could not be read.",
      404
    );
  }

  const resolved: Array<{ path: string; content: string }> = [];

  for (const file of input.files) {
    if (!safeCommitPath(file.path)) {
      throw new GithubWriteError(
        "refused",
        `That path is not safe to commit: ${file.path}`,
        403
      );
    }

    // A whole-file write replaces whatever is there now.
    if (file.mode === "write") {
      resolved.push({ path: file.path, content: file.proposed });
      continue;
    }

    const anchor = file.original === null ? null : deriveReplacement(file.original, file.proposed);
    if (!anchor) return { ok: false };

    const current = await readFileAt(input.token, input.repoPath, head, file.path);
    if (current === null) return { ok: false };

    const next = replaceOnce(current, anchor.find, anchor.replace);
    if (next === null) return { ok: false };

    resolved.push({ path: file.path, content: next });
  }

  for (const file of resolved) {
    if (Buffer.byteLength(file.content, "utf8") > MAX_COMMIT_FILE_BYTES) {
      throw new GithubWriteError(
        "refused",
        `${file.path} is over the ${MAX_COMMIT_FILE_BYTES.toLocaleString()} byte cap.`,
        403
      );
    }
  }

  const headCommit = await request<{ tree: { sha: string } }>(
    input.token,
    "GET",
    `${input.repoPath}/git/commits/${encodeURIComponent(head)}`
  );

  const tree = await request<{ sha: string }>(input.token, "POST", `${input.repoPath}/git/trees`, {
    base_tree: headCommit.tree.sha,
    tree: resolved.map((file) => ({
      path: file.path,
      mode: "100644",
      type: "blob",
      content: file.content,
    })),
  });

  const commit = await request<{ sha: string }>(
    input.token,
    "POST",
    `${input.repoPath}/git/commits`,
    {
      message: `Openmi: re-apply ${resolved.length} file(s)\n\nChangeset ${input.changesetId}, approved in the app.`,
      tree: tree.sha,
      parents: [head],
    }
  );

  // Not forced. A move GitHub will not accept is reported, never overwritten.
  await request(
    input.token,
    "PATCH",
    `${input.repoPath}/git/refs/heads/${encodedBranch(input.branch)}`,
    { sha: commit.sha, force: false }
  );

  return { ok: true };
}

async function closePullRequest(
  token: string,
  repoPath: string,
  number: number
): Promise<void> {
  await request(token, "PATCH", `${repoPath}/pulls/${number}`, { state: "closed" });
}

/** Deletes an agent branch after it has served its purpose. A 404 is success. */
async function deleteAgentBranch(
  token: string,
  repoPath: string,
  branch: string
): Promise<void> {
  try {
    await request(token, "DELETE", `${repoPath}/git/refs/heads/${encodedBranch(branch)}`);
  } catch (caught) {
    if (caught instanceof GithubWriteError && caught.failure === "not-found") return;
    throw caught;
  }
}

/**
 * Applies an approved change: wait for mergeability, reconcile a dirty branch,
 * then squash-merge and delete the agent branch.
 *
 * A 405 or 409 means GitHub changed its mind between the poll and the merge, so
 * the poll and the reconcile run once more before one retry. A second refusal is
 * reported; the pull request is left open for inspection. Only a replacement
 * that can no longer be applied exactly once closes the pull request.
 */
export async function mergeProposal({
  token,
  repo,
  defaultBranch,
  branch,
  prNumber,
  changesetId,
  files,
  sleep = sleepFor,
}: {
  token: string;
  repo: string;
  defaultBranch: string;
  branch: string;
  prNumber: number;
  changesetId: string;
  files: ChangedFile[];
  sleep?: Sleep;
}): Promise<AutoMergeOutcome> {
  const repoPath = repoPathOf(repo);

  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new GithubWriteError("refused", "That change has no pull request to apply.", 403);
  }

  // The pull-request path is still an agent-branch path. Nothing else merges.
  assertAgentBranch(branch, defaultBranch);

  if (files.length === 0) {
    throw new GithubWriteError("refused", "There is nothing to apply.", 403);
  }

  let reapplied = false;

  const prepare = async (): Promise<
    { ok: true } | { ok: false; outcome: AutoMergeOutcome }
  > => {
    let state = await waitForMergeable({ token, repo, number: prNumber, sleep });

    if (state.mergeable === false || state.mergeableState === "dirty") {
      const reconcile = await reapplyOnHead({
        token,
        repoPath,
        branch,
        defaultBranch,
        changesetId,
        files,
      });

      if (!reconcile.ok) {
        await closePullRequest(token, repoPath, prNumber);
        await deleteAgentBranch(token, repoPath, branch);

        return {
          ok: false,
          outcome: {
            ok: false,
            error: CONFLICT_REAPPLY_MESSAGE,
            pullRequestClosed: true,
          },
        };
      }

      reapplied = true;
      state = await waitForMergeable({ token, repo, number: prNumber, sleep });
    }

    if (state.mergeable !== true) {
      return {
        ok: false,
        outcome: { ok: false, error: MERGE_UNAVAILABLE_MESSAGE, pullRequestClosed: false },
      };
    }

    return { ok: true };
  };

  const mergeOnce = async (): Promise<string> => {
    const result = await request<{ merged?: boolean; sha?: string; message?: string }>(
      token,
      "PUT",
      `${repoPath}/pulls/${prNumber}/merge`,
      { merge_method: "squash" }
    );

    if (result.merged !== true || typeof result.sha !== "string") {
      throw new GithubWriteError("conflict", result.message ?? MERGE_UNAVAILABLE_MESSAGE, 405);
    }

    return result.sha;
  };

  let prepared = await prepare();
  if (!prepared.ok) return prepared.outcome;

  let mergeCommitSha: string;

  try {
    mergeCommitSha = await mergeOnce();
  } catch (caught) {
    if (
      !(caught instanceof GithubWriteError) ||
      (caught.status !== 405 && caught.status !== 409)
    ) {
      throw caught;
    }

    prepared = await prepare();
    if (!prepared.ok) return prepared.outcome;

    try {
      mergeCommitSha = await mergeOnce();
    } catch (retry) {
      if (
        !(retry instanceof GithubWriteError) ||
        (retry.status !== 405 && retry.status !== 409)
      ) {
        throw retry;
      }

      return {
        ok: false,
        error: MERGE_UNAVAILABLE_MESSAGE,
        pullRequestClosed: false,
      };
    }
  }

  await deleteAgentBranch(token, repoPath, branch);

  return { ok: true, mergeCommitSha, reapplied };
}

/**
 * Undo: one revert commit that restores every changed file to its content at
 * the changeset's base commit.
 *
 * The tree is built on the current head's tree, so untouched files keep their
 * current content, and a file that did not exist at the base is removed with a
 * null sha. The default branch is moved without force; if it moved between the
 * read and the write the whole thing is read again, once.
 */
export async function revertChangeset({
  token,
  repo,
  defaultBranch,
  changesetId,
  files,
}: {
  token: string;
  repo: string;
  defaultBranch: string;
  changesetId: string;
  files: RevertFile[];
}): Promise<{ commitSha: string; headSha: string }> {
  const repoPath = repoPathOf(repo);

  if (!isSafeBranchName(defaultBranch)) {
    throw new GithubWriteError("refused", "The default branch name is not valid.", 403);
  }

  if (files.length === 0) {
    throw new GithubWriteError("refused", "There is nothing to undo.", 403);
  }

  if (files.length > MAX_COMMIT_FILES) {
    throw new GithubWriteError(
      "refused",
      `An undo carries at most ${MAX_COMMIT_FILES} files.`,
      403
    );
  }

  for (const file of files) {
    if (!safeCommitPath(file.path)) {
      throw new GithubWriteError(
        "refused",
        `That path is not safe to commit: ${file.path}`,
        403
      );
    }

    if (
      file.original !== null &&
      Buffer.byteLength(file.original, "utf8") > MAX_COMMIT_FILE_BYTES
    ) {
      throw new GithubWriteError(
        "refused",
        `${file.path} is over the ${MAX_COMMIT_FILE_BYTES.toLocaleString()} byte cap.`,
        403
      );
    }
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const head = await readBranchHead(token, repoPath, defaultBranch);

    if (head === null) {
      throw new GithubWriteError(
        "not-found",
        "The repository's default branch could not be read.",
        404
      );
    }

    const headCommit = await request<{ tree: { sha: string } }>(
      token,
      "GET",
      `${repoPath}/git/commits/${encodeURIComponent(head)}`
    );

    const tree = await request<{ sha: string }>(token, "POST", `${repoPath}/git/trees`, {
      base_tree: headCommit.tree.sha,
      tree: files.map((file) =>
        file.original === null
          ? { path: file.path, mode: "100644", type: "blob", sha: null }
          : { path: file.path, mode: "100644", type: "blob", content: file.original }
      ),
    });

    const commit = await request<{ sha: string }>(token, "POST", `${repoPath}/git/commits`, {
      message: `Openmi: undo ${files.length} file(s)\n\nChangeset ${changesetId} was undone in the app.`,
      tree: tree.sha,
      parents: [head],
    });

    try {
      await request(
        token,
        "PATCH",
        `${repoPath}/git/refs/heads/${encodedBranch(defaultBranch)}`,
        { sha: commit.sha, force: false }
      );

      return { commitSha: commit.sha, headSha: head };
    } catch (caught) {
      lastError = caught;

      if (attempt === 2) throw caught;

      // The branch moved under the read: build the revert again on the new head.
      if (
        !(caught instanceof GithubWriteError) ||
        (caught.status !== 405 && caught.status !== 409 && caught.status !== 422)
      ) {
        throw caught;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new GithubWriteError("unavailable", "The change could not be undone.", 0);
}

function isRepositoryName(value: string): boolean {
  const name = value.trim();

  if (name.length === 0 || name.length > 100) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return false;

  return name !== "." && name !== ".." && !name.toLowerCase().endsWith(".git");
}

/**
 * Creates a private repository with exactly one commit.
 *
 * This is the only place Openmi creates a repository instead of writing to one,
 * and it is deliberately narrow: the files are a template's, written once, and
 * every later change still travels through changeset → branch → pull request.
 * The alternative — a second general write path — is what the product refuses.
 *
 * The repository is private by default: a half-built app is the reader's work
 * before it is anything else, and publishing is a separate, explicit action.
 */
export async function createRepositoryWithFiles(input: {
  token: string;
  name: string;
  description: string;
  files: ProposedFile[];
  isPrivate?: boolean;
}): Promise<{ fullName: string; branch: string; commitSha: string }> {
  const name = input.name.trim();

  if (!isRepositoryName(name)) {
    throw new GithubWriteError(
      "refused",
      "Repository names use letters, numbers, dots, dashes and underscores, and start with a letter or number.",
      400
    );
  }

  if (input.files.length === 0 || input.files.length > MAX_COMMIT_FILES) {
    throw new GithubWriteError(
      "refused",
      `A template must have between 1 and ${MAX_COMMIT_FILES} files.`,
      400
    );
  }

  for (const file of input.files) {
    if (!safeCommitPath(file.path)) {
      throw new GithubWriteError("refused", `The template path ${file.path} is not allowed.`, 400);
    }

    if (Buffer.byteLength(file.content, "utf8") > MAX_COMMIT_FILE_BYTES) {
      throw new GithubWriteError(
        "refused",
        `${file.path} is larger than the ${MAX_COMMIT_FILE_BYTES} byte template cap.`,
        400
      );
    }
  }

  let created: { full_name: string };
  try {
    created = await request<{ full_name: string }>(input.token, "POST", "/user/repos", {
      name,
      description: input.description.slice(0, 200),
      private: input.isPrivate ?? true,
      // No initial commit of GitHub's own: the first commit is the template, so
      // the chat is pinned to something that actually contains the app.
      auto_init: false,
      default_branch: "main",
    });
  } catch (caught) {
    if (
      caught instanceof GithubWriteError &&
      (caught.status === 422 || caught.status === 409)
    ) {
      throw new GithubWriteError(
        "conflict",
        `A repository named "${name}" already exists, or GitHub refused that name.`,
        422
      );
    }

    if (caught instanceof GithubWriteError && caught.status === 403) {
      throw new GithubWriteError(
        "forbidden",
        "The connected token cannot create repositories. Reconnect GitHub with a token that has repo scope.",
        403
      );
    }

    throw caught;
  }

  const [owner, repoName] = created.full_name.split("/");
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`;

  const blobs: Array<{ path: string; sha: string }> = [];

  for (const file of input.files) {
    const blob = await request<{ sha: string }>(input.token, "POST", `${repoPath}/git/blobs`, {
      content: file.content,
      encoding: "utf-8",
    });

    blobs.push({ path: file.path, sha: blob.sha });
  }

  const tree = await request<{ sha: string }>(input.token, "POST", `${repoPath}/git/trees`, {
    tree: blobs.map((blob) => ({
      path: blob.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    })),
  });

  const commit = await request<{ sha: string }>(input.token, "POST", `${repoPath}/git/commits`, {
    message:
      "Openmi: start from a template\n\nOne commit, written once. Every later change goes through a changeset and a pull request.",
    tree: tree.sha,
    parents: [],
  });

  await request(input.token, "POST", `${repoPath}/git/refs`, {
    ref: "refs/heads/main",
    sha: commit.sha,
  });

  return { fullName: created.full_name, branch: "main", commitSha: commit.sha };
}
