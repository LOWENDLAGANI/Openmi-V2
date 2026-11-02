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
