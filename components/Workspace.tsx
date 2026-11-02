import Link from "next/link";

import { PathFilter } from "@/components/PathFilter";
import { MAX_PATH_INDEX, MAX_VIEW_LINES } from "@/lib/github/read";
import type {
  CodeSearch,
  FileView,
  RepoSummary,
  RepoTree,
  TreeEntry,
} from "@/lib/github/types";

export type WorkspaceProps = {
  repo: RepoSummary;
  branch: string;
  branches: string[];
  sha: string;
  tree: RepoTree;
  dir: string;
  path: string | null;
  line: number | null;
  file: FileView | null;
  fileError: string | null;
  search: CodeSearch | null;
  searchError: string | null;
  chatId?: string;
};

type Base = { repo: string; branch: string; sha: string; chat?: string };

function href(base: Base, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  params.set("repo", base.repo);
  params.set("branch", base.branch);
  params.set("sha", base.sha);
  if (base.chat) params.set("chat", base.chat);

  for (const [key, value] of Object.entries(extra)) {
    if (value && value.length > 0) params.set(key, value);
  }

  return `/chat?${params.toString()}`;
}

function directoryEntries(entries: TreeEntry[], dir: string): TreeEntry[] {
  const prefix = dir ? `${dir}/` : "";
  const found = new Map<string, TreeEntry>();

  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const rest = entry.path.slice(prefix.length);
    if (rest.length === 0 || rest.includes("/")) continue;
    found.set(rest, entry);
  }

  return [...found.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

function CodeView({ text, highlight }: { text: string; highlight: number | null }) {
  const lines = text.split("\n");
  const shown = lines.slice(0, MAX_VIEW_LINES);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="max-h-[70vh] overflow-auto">
        <ol className="min-w-max py-2 font-mono text-[12px] leading-[1.7]">
          {shown.map((content, index) => {
            const number = index + 1;
            const active = highlight === number;

            return (
              <li
                key={number}
                id={`L${number}`}
                className={`flex gap-4 px-4 ${active ? "bg-accent-soft" : ""}`}
              >
                <span
                  className={`w-9 shrink-0 select-none text-right ${
                    active ? "text-accent-text" : "text-low"
                  }`}
                >
                  {number}
                </span>
                <span className="whitespace-pre text-body">
                  {content.length === 0 ? " " : content}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {lines.length > shown.length && (
        <p className="border-t border-line px-4 py-2 text-[11px] text-mid">
          Showing the first {shown.length} of {lines.length} lines. The rest is on
          GitHub.
        </p>
      )}
    </div>
  );
}

export function Workspace(props: WorkspaceProps) {
  const {
    repo,
    branch,
    branches,
    sha,
    tree,
    dir,
    path,
    line,
    file,
    fileError,
    search,
    searchError,
    chatId,
  } = props;

  const base: Base = { repo: repo.fullName, branch, sha, chat: chatId };
  const entries = directoryEntries(tree.entries, dir);
  const blobPaths = tree.entries
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path);
  const segments = dir.split("/").filter((segment) => segment.length > 0);
  const pickerHref = chatId ? `/chat?chat=${chatId}&view=repos` : "/chat";
  const externalUrl = file
    ? `https://github.com/${repo.fullName}/blob/${sha}/${file.path}${line ? `#L${line}` : ""}`
    : null;

  return (
    <div className="fade-in mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">workspace</p>
          <h2 className="mt-1 flex items-center gap-2 truncate text-[21px] font-semibold tracking-[-0.02em] text-hi">
            {repo.fullName}
            {repo.private && (
              <span className="eyebrow rounded-full bg-chip px-2 py-0.5">private</span>
            )}
          </h2>
          <p
            className="mt-1 font-mono text-[11px] text-low"
            title="Every read below resolves at this commit."
          >
            {sha.slice(0, 7)} · {branch}
          </p>
        </div>

        <Link href={pickerHref} className="btn px-4 py-1.5 text-[12px]">
          Change repository
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-3">
          <form action="/chat" method="get" className="flex items-center gap-1.5">
            {chatId && <input type="hidden" name="chat" value={chatId} />}
            <input type="hidden" name="repo" value={repo.fullName} />
            <select
              name="branch"
              defaultValue={branch}
              aria-label="Branch"
              className="field min-w-0 flex-1 px-3 py-1.5 text-[12px]"
            >
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button className="btn px-3 py-1.5 text-[12px]">Switch</button>
          </form>

          <PathFilter
            paths={blobPaths.slice(0, MAX_PATH_INDEX)}
            truncated={blobPaths.length > MAX_PATH_INDEX}
            repo={repo.fullName}
            branch={branch}
            sha={sha}
            chatId={chatId}
          />

          <nav aria-label="Repository files" className="panel p-2">
            <p className="flex flex-wrap items-center gap-1 px-2 pb-2 pt-1 font-mono text-[11px] text-low">
              <Link href={href(base)} className="hover:text-hi">
                {repo.name}
              </Link>
              {segments.map((segment, index) => {
                const target = segments.slice(0, index + 1).join("/");
                return (
                  <span key={target} className="flex items-center gap-1">
                    <span aria-hidden="true">/</span>
                    <Link href={href(base, { dir: target })} className="hover:text-hi">
                      {segment}
                    </Link>
                  </span>
                );
              })}
            </p>

            <ul className="max-h-[46vh] overflow-y-auto">
              {dir && (
                <li>
                  <Link
                    href={href(base, { dir: segments.slice(0, -1).join("/") })}
                    className="block rounded-full px-3 py-1.5 font-mono text-[11.5px] text-low hover:bg-hover hover:text-hi"
                  >
                    ..
                  </Link>
                </li>
              )}

              {entries.length === 0 ? (
                <li className="px-3 py-1.5 text-[11.5px] text-low">Empty directory.</li>
              ) : (
                entries.map((entry) =>
                  entry.type === "tree" ? (
                    <li key={entry.path}>
                      <Link
                        href={href(base, { dir: entry.path })}
                        className="block truncate rounded-full px-3 py-1.5 text-[12px] text-mid hover:bg-hover hover:text-hi"
                      >
                        {entry.path.split("/").pop()}/
                      </Link>
                    </li>
                  ) : (
                    <li key={entry.path}>
                      <Link
                        href={href(base, { path: entry.path, dir })}
                        aria-current={path === entry.path ? "true" : undefined}
                        className={`block truncate rounded-full px-3 py-1.5 text-[12px] hover:bg-hover hover:text-hi ${
                          path === entry.path
                            ? "bg-accent-soft font-medium text-hi"
                            : "text-body"
                        }`}
                      >
                        {entry.path.split("/").pop()}
                      </Link>
                    </li>
                  )
                )
              )}
            </ul>

            {tree.truncated && (
              <p className="px-3 pt-2 text-[10.5px] text-low">
                Tree truncated at {tree.entries.length} entries.
              </p>
            )}
          </nav>

          <form action="/chat" method="get" className="space-y-1.5">
            {chatId && <input type="hidden" name="chat" value={chatId} />}
            <input type="hidden" name="repo" value={repo.fullName} />
            <input type="hidden" name="branch" value={branch} />
            <input type="hidden" name="sha" value={sha} />
            <input
              name="q"
              defaultValue={search?.query ?? ""}
              placeholder="Search code in this repository"
              aria-label="Search code"
              className="field px-3 py-1.5 text-[12px]"
            />
            <button className="btn w-full py-1.5 text-[12px]">Search code</button>
          </form>

          {searchError && (
            <p
              role="alert"
              className="rounded-2xl border border-danger/25 bg-danger/8 px-3 py-2 text-[11px] text-danger"
            >
              {searchError}
            </p>
          )}

          {search && (
            <section className="panel p-2">
              <p className="eyebrow px-2 pb-1.5 pt-1">
                {search.totalCount} github match{search.totalCount === 1 ? "" : "es"} ·{" "}
                {search.hits.length} shown
              </p>

              {search.hits.length === 0 ? (
                <p className="px-2 pb-1 text-[11.5px] text-mid">No code match.</p>
              ) : (
                <ul className="max-h-[30vh] overflow-y-auto">
                  {search.hits.map((hit) => (
                    <li key={hit.path}>
                      <Link
                        href={href(base, {
                          path: hit.path,
                          line: hit.line ? String(hit.line) : undefined,
                        })}
                        className="block truncate rounded-full px-3 py-1.5 font-mono text-[11px] text-body hover:bg-hover hover:text-hi"
                      >
                        {hit.path}
                        {hit.line ? `:${hit.line}` : ""}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <p className="px-2 pt-2 text-[10px] leading-relaxed text-low">
                GitHub searches the default branch; line numbers are resolved at{" "}
                {sha.slice(0, 7)}.
              </p>
            </section>
          )}
        </aside>

        <section className="min-w-0 space-y-2">
          {file ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                <p className="min-w-0 truncate font-mono text-[12px] text-body">
                  {file.path}
                </p>
                <div className="flex items-center gap-3 font-mono text-[10.5px] text-low">
                  <span>{file.bytes.toLocaleString()} bytes</span>
                  {externalUrl && (
                    <a
                      href={externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-hi"
                    >
                      github ↗
                    </a>
                  )}
                </div>
              </div>
              <CodeView text={file.text} highlight={line} />
            </>
          ) : fileError ? (
            <p
              role="alert"
              className="panel px-5 py-4 text-[12.5px] text-mid"
            >
              {fileError}
            </p>
          ) : (
            <div className="rounded-3xl border border-dashed border-line-strong px-6 py-20 text-center">
              <p className="eyebrow">nothing open</p>
              <p className="mt-2 text-[17px] font-semibold tracking-[-0.02em] text-hi">
                Pick a file from the tree.
              </p>
              <p className="mx-auto mt-2 max-w-sm text-[12.5px] leading-relaxed text-mid">
                Everything is read at {sha.slice(0, 7)}, so the line numbers you
                see are the ones a diff will use.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
