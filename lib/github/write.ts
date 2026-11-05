import {
  AGENT_BRANCH_PATTERN,
  agentBranchName,
  isSafeBranchName,
} from "@/lib/branch";
import { GITHUB_API, GITHUB_TIMEOUT_MS, isRepoFullName } from "./read";

export { AGENT_BRANCH_PREFIX, agentBranchName } from "@/lib/branch";

/**
 * The only module in the app that writes to GitHub.
 *
 * The safety property is structural, not a prompt instruction. A pull request
 * always goes to a branch derived from the changeset id, and every write on
 * that path goes through `assertAgentBranch` first. A direct commit, which the
 * reader asks for explicitly, names its branch instead: the name must pass
 * git's own rules, the branch head must still be the pinned base, and the ref
 * is updated without force. A branch that has moved is refused, never
 * overwritten. tests/github-read.test.ts keeps read-only modules GET-only and
 * tests/github-write.test.ts pins both refusals and the request shapes.
 *
 * One approval means one commit and either one agent branch with a pull request
 * or one direct branch update. The changeset id is the idempotency key: the
 * agent branch name contains it, the commit is content-addressed by GitHub, and
 * an existing pull request is reused rather than duplicated on retry.
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

type WriteMethod = "GET" | "POST" | "PATCH";

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
  // derived from this changeset, based on the repository default. A direct
  // commit may name any valid branch, and its base is checked against the live
  // head below rather than assumed.
  const direct = targetBranch !== undefined;
  const branch = direct ? targetBranch.trim() : agentBranchName(changesetId);

  if (direct) {
    assertSafeBranch(branch);
  } else {
    assertAgentBranch(branch, defaultBranch);
    assertBaseBranch(baseBranch, defaultBranch);
  }

  const [owner, name] = repo.split("/");
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  await onProgress?.({ branch });

  // Direct commits read the branch before writing anything. A branch that is
  // not at the pinned base is refused rather than overwritten, and a missing
  // branch is created once the commit exists.
  let branchHead: string | null = null;

  if (direct) {
    branchHead = await readBranchHead(token, repoPath, branch);

    if (
      branchHead !== null &&
      branchHead !== baseSha &&
      branchHead !== existingCommitSha
    ) {
      throw new GithubWriteError(
        "conflict",
        `The branch ${branch} has moved to ${branchHead.slice(0, 7)}; this diff was computed at ${baseSha.slice(0, 7)}. Nothing was committed.`,
        409
      );
    }
  }

  let commitSha = existingCommitSha ?? "";

  if (commitSha.length === 0) {
    const baseCommit = await request<{ tree: { sha: string } }>(
      token,
      "GET",
      `${repoPath}/git/commits/${encodeURIComponent(baseSha)}`
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
      parents: [baseSha],
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
