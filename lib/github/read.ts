/**
 * GitHub reads.
 *
 * This module is GET-only by construction: there is exactly one `fetch` call
 * site and it hard-codes the method. tests/github-read.test.ts fails if a
 * second call site appears, or if any other HTTP method shows up anywhere under
 * lib/github/. Writes arrive in phase 6 in their own module, with the
 * default-branch refusal beside them.
 *
 * Nothing here accepts a URL from outside: every function takes a token plus
 * the pieces of a path, and builds the request itself.
 */

import type {
  CodeHit,
  CodeSearch,
  FileView,
  GithubFailure,
  RepoSummary,
  RepoTree,
  TreeEntry,
} from "./types";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_TIMEOUT_MS = 15_000;

/** Caps. Every one of these is asserted in tests/github-read.test.ts. */
export const MAX_REPO_PAGES = 3;
export const MAX_REPOS = 300;
export const MAX_BRANCHES = 200;
export const MAX_TREE_ENTRIES = 5_000;
export const MAX_PATH_INDEX = 3_000;
export const MAX_SEARCH_HITS = 20;
export const MAX_SEARCH_FILE_FETCHES = 10;
export const MAX_VIEW_BYTES = 200_000;
export const MAX_VIEW_LINES = 2_000;

export class GithubError extends Error {
  readonly failure: GithubFailure;
  readonly status: number;

  constructor(failure: GithubFailure, message: string, status = 0) {
    super(message);
    this.name = "GithubError";
    this.failure = failure;
    this.status = status;
  }
}

export type { CodeHit, CodeSearch, FileView, RepoSummary, RepoTree, TreeEntry };

export function describeGithubError(error: unknown): string {
  if (error instanceof GithubError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "GitHub could not be reached.";
}

type Wire<T> = { data: T; headers: Headers };

type WireRepo = {
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  language: string | null;
  pushed_at: string | null;
  stargazers_count: number;
  owner: { login: string };
};

function repoBase(fullName: string): string {
  const [owner, name] = fullName.split("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

export function isRepoFullName(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(value);
}

export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/.test(value);
}

async function request<T>(
  token: string,
  path: string,
  accept = "application/vnd.github+json"
): Promise<Wire<T>> {
  const url = path.startsWith("https://") ? path : `${GITHUB_API}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept,
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "openmi",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch {
    throw new GithubError(
      "unavailable",
      "GitHub did not answer within 15 seconds. Try again."
    );
  }

  if (response.ok) {
    return { data: (await response.json()) as T, headers: response.headers };
  }

  if (response.status === 401) {
    throw new GithubError(
      "unauthorized",
      "GitHub rejected the token. Reconnect with a new one.",
      401
    );
  }

  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0" || response.status === 429) {
      throw new GithubError(
        "rate-limited",
        "GitHub's rate limit is exhausted for this token. Wait a minute and retry.",
        response.status
      );
    }
    throw new GithubError(
      "unauthorized",
      "The token is not allowed to read that. Check its repository access.",
      403
    );
  }

  if (response.status === 404) {
    throw new GithubError(
      "not-found",
      "GitHub returned 404. The repository or path is not readable with this token.",
      404
    );
  }

  throw new GithubError("unavailable", `GitHub returned ${response.status}.`, response.status);
}

function toSummary(repo: WireRepo): RepoSummary {
  return {
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner.login,
    private: repo.private,
    defaultBranch: repo.default_branch,
    description: repo.description,
    language: repo.language,
    pushedAt: repo.pushed_at,
    stars: repo.stargazers_count,
  };
}

/** The account behind the token, plus the scopes GitHub reports for it. */
export async function getViewer(
  token: string
): Promise<{ login: string; name: string | null; scopes: string[] }> {
  const { data, headers } = await request<{ login: string; name: string | null }>(
    token,
    "/user"
  );

  const scopes = (headers.get("x-oauth-scopes") ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  return { login: data.login, name: data.name, scopes };
}

/** Every repository the token can read, newest push first. */
export async function listRepos(token: string): Promise<RepoSummary[]> {
  const repos: RepoSummary[] = [];

  for (let page = 1; page <= MAX_REPO_PAGES; page += 1) {
    const { data } = await request<WireRepo[]>(
      token,
      `/user/repos?per_page=100&page=${page}&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member`
    );

    repos.push(...data.map(toSummary));
    if (data.length < 100) break;
  }

  return repos.slice(0, MAX_REPOS);
}

export async function getRepo(token: string, fullName: string): Promise<RepoSummary> {
  const { data } = await request<WireRepo>(token, repoBase(fullName));
  return toSummary(data);
}

/**
 * GitHub's numeric id for a repository.
 *
 * The hosting provider names a repository by this id, not by `owner/name`, so
 * the value is read here rather than guessed from the string. It is a GET like
 * every other read in this module.
 */
export async function getRepoId(token: string, fullName: string): Promise<number> {
  const { data } = await request<{ id: number }>(token, repoBase(fullName));

  if (typeof data.id !== "number") {
    throw new GithubError("unavailable", "GitHub did not return a repository id.");
  }

  return data.id;
}

export async function listBranches(token: string, fullName: string): Promise<string[]> {
  const { data } = await request<Array<{ name: string }>>(
    token,
    `${repoBase(fullName)}/branches?per_page=${MAX_BRANCHES}`
  );

  return data.map((branch) => branch.name);
}

/** The commit a branch points at right now. This is what gets pinned. */
export async function resolveBranchSha(
  token: string,
  fullName: string,
  branch: string
): Promise<string> {
  const ref = branch
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");

  const { data } = await request<{ object: { sha: string } }>(
    token,
    `${repoBase(fullName)}/git/ref/heads/${ref}`
  );

  return data.object.sha;
}

export async function getTree(
  token: string,
  fullName: string,
  sha: string
): Promise<RepoTree> {
  const { data } = await request<{
    tree: Array<{ path: string; type: string; size?: number }>;
    truncated: boolean;
  }>(token, `${repoBase(fullName)}/git/trees/${encodeURIComponent(sha)}?recursive=1`);

  const entries: TreeEntry[] = [];

  for (const entry of data.tree) {
    if (entry.type !== "blob" && entry.type !== "tree") continue;
    entries.push({ path: entry.path, type: entry.type, size: entry.size ?? 0 });
    if (entries.length >= MAX_TREE_ENTRIES) break;
  }

  return { entries, truncated: data.truncated || data.tree.length > entries.length };
}

/** One file at one commit. Reading by sha is what makes the workspace a pin. */
export async function getFile(
  token: string,
  fullName: string,
  sha: string,
  path: string
): Promise<FileView> {
  const { data } = await request<{
    type: string;
    path: string;
    sha: string;
    size: number;
    encoding?: string;
    content?: string;
  }>(
    token,
    `${repoBase(fullName)}/contents/${encodePath(path)}?ref=${encodeURIComponent(sha)}`
  );

  if (data.type !== "file" || !data.content || data.encoding !== "base64") {
    throw new GithubError(
      "not-found",
      "That path is not a readable file at this commit."
    );
  }

  if (data.size > MAX_VIEW_BYTES) {
    throw new GithubError(
      "too-large",
      `This file is ${data.size.toLocaleString()} bytes. The viewer stops at ${MAX_VIEW_BYTES.toLocaleString()} so a page stays a page.`
    );
  }

  const text = Buffer.from(data.content, "base64").toString("utf8");

  if (text.includes("\u0000")) {
    throw new GithubError("too-large", "That file is binary. The viewer renders text only.");
  }

  return { path: data.path, sha: data.sha, text, bytes: data.size };
}

/**
 * GitHub code search, with the line number resolved locally.
 *
 * The search API returns paths, not lines, and it searches the default branch
 * rather than an arbitrary sha. So each candidate file is fetched at the pinned
 * commit and the first occurrence is located there. That is honest about both
 * facts: the UI says the search runs on the default branch, and every line it
 * shows is a line in the commit the workspace is pinned to.
 */
export async function searchCode(
  token: string,
  fullName: string,
  sha: string,
  query: string
): Promise<Omit<CodeSearch, "query">> {
  const trimmed = query.trim();

  if (trimmed.length < 2) return { hits: [], totalCount: 0 };

  const { data } = await request<{
    total_count: number;
    items: Array<{ path: string }>;
  }>(
    token,
    `/search/code?q=${encodeURIComponent(`${trimmed} repo:${fullName}`)}&per_page=${MAX_SEARCH_HITS}`,
    "application/vnd.github.text-match+json"
  );

  const hits: CodeHit[] = data.items
    .slice(0, MAX_SEARCH_HITS)
    .map((item) => ({ path: item.path, line: null }));

  const needle = trimmed.toLowerCase();

  await Promise.all(
    hits.slice(0, MAX_SEARCH_FILE_FETCHES).map(async (hit) => {
      try {
        const file = await getFile(token, fullName, sha, hit.path);
        const index = file.text.toLowerCase().indexOf(needle);
        if (index === -1) return;
        hit.line = file.text.slice(0, index).split("\n").length;
      } catch {
        // A binary or oversized file keeps its path-only hit. The UI shows the
        // path without a line rather than inventing one.
      }
    })
  );

  return { hits, totalCount: data.total_count };
}

// ── History and context ──────────────────────────────────────────────────────
//
// A run's workspace is one snapshot with no history: the archive is extracted
// and committed once, so `git log` there shows a single base commit. These reads
// are how the agent sees what actually changed and what is open in the
// repository, using the app's connection rather than a credential in the box.
// Still GETs, still built here, still no URL from outside.

export const MAX_HISTORY_COMMITS = 20;
export const MAX_HISTORY_FILES = 30;
export const MAX_PATCH_CHARS = 4_000;
export const MAX_CONTEXT_ITEMS = 20;
export const MAX_BODY_CHARS = 4_000;
export const MAX_CHECK_NAMES = 20;

export type CommitSummary = {
  sha: string;
  shortSha: string;
  /** The first line of the message. */
  message: string;
  author: string;
  date: string;
};

export type CommitFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** The diff for this file, capped. Null for a binary or oversized diff. */
  patch: string | null;
};

export type CommitDetail = CommitSummary & {
  body: string;
  files: CommitFile[];
  totalFiles: number;
  additions: number;
  deletions: number;
};

export type PullSummary = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  author: string;
  headBranch: string;
  baseBranch: string;
  updatedAt: string;
  mergedAt: string | null;
  url: string;
  body: string;
};

export type IssueSummary = {
  number: number;
  title: string;
  state: string;
  author: string;
  labels: string[];
  comments: number;
  updatedAt: string;
  url: string;
  body: string;
};

export type IssueComment = {
  author: string;
  createdAt: string;
  body: string;
};

export type CheckSummary = {
  /** success, failure, pending, or none when nothing reported. */
  state: "success" | "failure" | "pending" | "none";
  total: number;
  failing: string[];
  pending: string[];
};

type WireCommit = {
  sha: string;
  commit: {
    message?: string;
    author?: { name?: string; date?: string } | null;
  };
  parents?: Array<{ sha: string }>;
};

type WirePull = {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  user?: { login?: string } | null;
  head?: { ref?: string } | null;
  base?: { ref?: string } | null;
  updated_at?: string;
  merged_at?: string | null;
  html_url?: string;
  body?: string | null;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  mergeable?: boolean | null;
  mergeable_state?: string;
};

type WireIssue = {
  number: number;
  title: string;
  state: string;
  user?: { login?: string } | null;
  labels?: Array<{ name?: string } | string>;
  comments?: number;
  updated_at?: string;
  html_url?: string;
  body?: string | null;
  pull_request?: unknown;
};

function clampLimit(value: number | undefined, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return max;
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim().slice(0, 200);
}

function bodyOf(text: string | null | undefined): string {
  if (typeof text !== "string") return "";
  const rest = text.split("\n").slice(1).join("\n").trim();
  return rest.slice(0, MAX_BODY_CHARS);
}

function toCommitSummary(commit: WireCommit): CommitSummary {
  const message = commit.commit.message ?? "";

  return {
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    message: firstLine(message),
    author: commit.commit.author?.name ?? "unknown",
    date: commit.commit.author?.date ?? "",
  };
}

/** Recent commits, newest first, optionally for one path or ref. */
export async function listCommits(
  token: string,
  fullName: string,
  options: { path?: string; ref?: string; limit?: number } = {}
): Promise<CommitSummary[]> {
  const limit = clampLimit(options.limit, MAX_HISTORY_COMMITS);
  const query = new URLSearchParams({ per_page: String(limit) });
  if (options.path) query.set("path", options.path);
  if (options.ref) query.set("sha", options.ref);

  const { data } = await request<WireCommit[]>(
    token,
    `${repoBase(fullName)}/commits?${query.toString()}`
  );

  return data.slice(0, limit).map(toCommitSummary);
}

/** One commit: message, body, and its files with patches. */
export async function getCommitDetail(
  token: string,
  fullName: string,
  sha: string
): Promise<CommitDetail> {
  if (!isCommitSha(sha)) {
    throw new GithubError("not-found", "That is not a commit id.");
  }

  const { data } = await request<
    WireCommit & {
      files?: Array<{
        filename: string;
        status?: string;
        additions?: number;
        deletions?: number;
        patch?: string;
      }>;
      stats?: { additions?: number; deletions?: number };
    }
  >(token, `${repoBase(fullName)}/commits/${encodeURIComponent(sha)}`);

  const files = (data.files ?? []).slice(0, MAX_HISTORY_FILES).map((file) => ({
    path: file.filename,
    status: file.status ?? "modified",
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
    patch: typeof file.patch === "string" ? file.patch.slice(0, MAX_PATCH_CHARS) : null,
  }));

  const all = data.files ?? [];

  return {
    ...toCommitSummary(data),
    body: bodyOf(data.commit.message),
    files,
    totalFiles: all.length,
    additions:
      data.stats?.additions ?? all.reduce((total, file) => total + (file.additions ?? 0), 0),
    deletions:
      data.stats?.deletions ?? all.reduce((total, file) => total + (file.deletions ?? 0), 0),
  };
}

function toPullSummary(pull: WirePull): PullSummary {
  return {
    number: pull.number,
    title: pull.title,
    state: pull.state,
    draft: pull.draft === true,
    author: pull.user?.login ?? "unknown",
    headBranch: pull.head?.ref ?? "",
    baseBranch: pull.base?.ref ?? "",
    updatedAt: pull.updated_at ?? "",
    mergedAt: pull.merged_at ?? null,
    url: pull.html_url ?? "",
    body: (pull.body ?? "").slice(0, MAX_BODY_CHARS),
  };
}

/** Pull requests, newest first. `all` includes closed and merged ones. */
export async function listPulls(
  token: string,
  fullName: string,
  state: "open" | "closed" | "all" = "open",
  limit: number = MAX_CONTEXT_ITEMS
): Promise<PullSummary[]> {
  const count = clampLimit(limit, MAX_CONTEXT_ITEMS);

  const { data } = await request<WirePull[]>(
    token,
    `${repoBase(fullName)}/pulls?state=${state}&per_page=${count}&sort=updated&direction=desc`
  );

  return data.slice(0, count).map(toPullSummary);
}

/** One pull request, with its size and whether GitHub can merge it. */
export async function getPullDetail(
  token: string,
  fullName: string,
  number: number
): Promise<
  PullSummary & {
    additions: number;
    deletions: number;
    changedFiles: number;
    mergeable: boolean | null;
    mergeableState: string;
  }
> {
  const { data } = await request<WirePull>(
    token,
    `${repoBase(fullName)}/pulls/${number}`
  );

  return {
    ...toPullSummary(data),
    additions: data.additions ?? 0,
    deletions: data.deletions ?? 0,
    changedFiles: data.changed_files ?? 0,
    mergeable: data.mergeable ?? null,
    mergeableState: data.mergeable_state ?? "unknown",
  };
}

function toIssueSummary(issue: WireIssue): IssueSummary {
  const labels = (issue.labels ?? [])
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .filter((label) => label.length > 0);

  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.user?.login ?? "unknown",
    labels,
    comments: issue.comments ?? 0,
    updatedAt: issue.updated_at ?? "",
    url: issue.html_url ?? "",
    body: (issue.body ?? "").slice(0, MAX_BODY_CHARS),
  };
}

/**
 * Issues, newest first. GitHub's issues endpoint also returns pull requests, so
 * anything carrying `pull_request` is dropped: an issue list that silently
 * includes PRs is a list the reader cannot trust.
 */
export async function listIssues(
  token: string,
  fullName: string,
  state: "open" | "closed" | "all" = "open",
  limit: number = MAX_CONTEXT_ITEMS
): Promise<IssueSummary[]> {
  const count = clampLimit(limit, MAX_CONTEXT_ITEMS);

  const { data } = await request<WireIssue[]>(
    token,
    `${repoBase(fullName)}/issues?state=${state}&per_page=${count}&sort=updated&direction=desc`
  );

  return data
    .filter((issue) => issue.pull_request === undefined)
    .slice(0, count)
    .map(toIssueSummary);
}

/** One issue. `isPull` is true when the number is a pull request. */
export async function getIssueDetail(
  token: string,
  fullName: string,
  number: number
): Promise<IssueSummary & { isPull: boolean }> {
  const { data } = await request<WireIssue>(
    token,
    `${repoBase(fullName)}/issues/${number}`
  );

  return { ...toIssueSummary(data), isPull: data.pull_request !== undefined };
}

/** The conversation on an issue or a pull request, oldest first. */
export async function listIssueComments(
  token: string,
  fullName: string,
  number: number,
  limit: number = MAX_CONTEXT_ITEMS
): Promise<IssueComment[]> {
  const count = clampLimit(limit, MAX_CONTEXT_ITEMS);

  const { data } = await request<
    Array<{ user?: { login?: string } | null; created_at?: string; body?: string | null }>
  >(token, `${repoBase(fullName)}/issues/${number}/comments?per_page=${count}`);

  return data.slice(0, count).map((comment) => ({
    author: comment.user?.login ?? "unknown",
    createdAt: comment.created_at ?? "",
    body: (comment.body ?? "").slice(0, MAX_BODY_CHARS),
  }));
}

/**
 * Check runs for a ref, folded into one state.
 *
 * A failure anywhere wins over a pending run, because a red check is the fact a
 * reader needs first. Names are capped: the count is the answer, the list is
 * the detail.
 */
export async function getChecks(
  token: string,
  fullName: string,
  ref: string
): Promise<CheckSummary> {
  const { data } = await request<{
    total_count?: number;
    check_runs?: Array<{ name?: string; status?: string; conclusion?: string | null }>;
  }>(
    token,
    `${repoBase(fullName)}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`
  );

  const runs = data.check_runs ?? [];
  const failing: string[] = [];
  const pending: string[] = [];

  for (const run of runs) {
    const name = run.name ?? "unnamed";

    if (run.conclusion === "failure" || run.conclusion === "timed_out" || run.conclusion === "cancelled") {
      failing.push(name);
    } else if (run.status !== "completed") {
      pending.push(name);
    }
  }

  const state = failing.length > 0
    ? "failure"
    : pending.length > 0
      ? "pending"
      : runs.length > 0
        ? "success"
        : "none";

  return {
    state,
    total: data.total_count ?? runs.length,
    failing: failing.slice(0, MAX_CHECK_NAMES),
    pending: pending.slice(0, MAX_CHECK_NAMES),
  };
}
