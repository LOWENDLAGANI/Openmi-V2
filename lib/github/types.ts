/**
 * Wire shapes for the GitHub read client, kept in a module with no runtime
 * code so client components can import the types without pulling the client in.
 */

export type RepoSummary = {
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  pushedAt: string | null;
  stars: number;
};

export type TreeEntry = {
  path: string;
  type: "blob" | "tree";
  size: number;
};

export type RepoTree = {
  entries: TreeEntry[];
  truncated: boolean;
};

export type FileView = {
  path: string;
  sha: string;
  text: string;
  bytes: number;
};

export type CodeHit = {
  path: string;
  /** Null when the file could not be fetched or the match text was not found. */
  line: number | null;
};

export type CodeSearch = {
  query: string;
  hits: CodeHit[];
  totalCount: number;
};

export type GithubFailure =
  | "unauthorized"
  | "not-found"
  | "rate-limited"
  | "unavailable"
  | "too-large";
