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
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-line bg-card">
      <ol className="min-w-max py-2 font-mono text-[12px] leading-[1.6]">
        {shown.map((content, index) => {
          const number = index + 1;
          const active = highlight === number;

          return (
            <li
              key={number}
              id={`L${number}`}
              className={`flex gap-3 px-3 ${active ? "bg-chip" : ""}`}
            >
              <span
                className={`w-10 shrink-0 select-none text-right ${
                  active ? "text-hi" : "text-low"
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

      {lines.length > shown.length && (
        <p className="border-t border-line px-3 py-2 text-[11px] text-mid">
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
  const pickerHref = chatId ? `/chat?chat=${chatId}` : "/chat";
  const externalUrl = file
    ? `https://github.com/${repo.fullName}/blob/${sha}/${file.path}${line ? `#L${line}` : ""}`
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-low">
            Workspace
          </p>
          <h2 className="flex items-center gap-2 truncate text-[15px] font-semibold text-hi">
            {repo.fullName}
            {repo.private && (
              <span className="rounded-full border border-line bg-chip px-2 py-0.5 text-[10px] font-normal uppercase tracking-[0.1em] text-mid">
                Private
              </span>
            )}
          </h2>
          <p
            className="mt-0.5 font-mono text-[11px] text-low"
            title="Every read below resolves at this commit."
          >
            {sha.slice(0, 7)} · {branch}
          </p>
        </div>

        <Link
          href={pickerHref}
          className="rounded-lg border border-line bg-card px-3 py-1.5 text-[12px] text-mid hover:text-hi"
        >
          Change repository
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-3">
          <form action="/chat" method="get" className="flex items-center gap-1.5">
            {chatId && <input type="hidden" name="chat" value={chatId} />}
            <input type="hidden" name="repo" value={repo.fullName} />
            <select
              name="branch"
              defaultValue={branch}
              aria-label="Branch"
              className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-[12px] text-body"
            >
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button className="rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[12px] text-mid hover:text-hi">
              Switch
            </button>
          </form>

          <PathFilter
            paths={blobPaths.slice(0, MAX_PATH_INDEX)}
            truncated={blobPaths.length > MAX_PATH_INDEX}
            repo={repo.fullName}
            branch={branch}
            sha={sha}
            chatId={chatId}
          />

          <nav
            aria-label="Repository files"
            className="rounded-xl border border-line bg-card p-2"
          >
            <p className="flex flex-wrap items-center gap-1 px-1 pb-1.5 font-mono text-[11px] text-low">
              <Link href={href(base)} className="hover:text-hi">
                {repo.name}
              </Link>
              {segments.map((segment, index) => {
                const target = segments.slice(0, index + 1).join("/");
                return (
                  <span key={target} className="flex items-center gap-1">
                    <span aria-hidden>/</span>
                    <Link href={href(base, { dir: target })} className="hover:text-hi">
                      {segment}
                    </Link>
                  </span>
                );
              })}
            </p>

            <ul className="max-h-[46vh] overflow-y-auto text-[12px]">
              {dir && (
                <li>
                  <Link
                    href={href(base, { dir: segments.slice(0, -1).join("/") })}
                    className="block rounded px-1.5 py-1 text-low hover:bg-hover hover:text-hi"
                  >
                    ..
                  </Link>
                </li>
              )}

              {entries.length === 0 ? (
                <li className="px-1.5 py-1 text-low">Empty directory.</li>
              ) : (
                entries.map((entry) =>
                  entry.type === "tree" ? (
                    <li key={entry.path}>
                      <Link
                        href={href(base, { dir: entry.path })}
                        className="block truncate rounded px-1.5 py-1 text-mid hover:bg-hover hover:text-hi"
                      >
                        {entry.path.split("/").pop()}/
                      </Link>
                    </li>
                  ) : (
                    <li key={entry.path}>
                      <Link
                        href={href(base, { path: entry.path, dir })}
                        aria-current={path === entry.path ? "true" : undefined}
                        className={`block truncate rounded px-1.5 py-1 hover:bg-hover hover:text-hi ${
                          path === entry.path ? "bg-chip text-hi" : "text-body"
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
              <p className="px-1 pt-1.5 text-[10.5px] text-low">
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
              className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12px] text-body placeholder:text-low"
            />
            <button className="w-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-[12px] text-mid hover:text-hi">
              Search code
            </button>
          </form>

          {searchError && (
            <p
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger"
            >
              {searchError}
            </p>
          )}

          {search && (
            <section className="rounded-xl border border-line bg-card p-2">
              <p className="px-1 pb-1 text-[10.5px] text-low">
                {search.totalCount} GitHub match
                {search.totalCount === 1 ? "" : "es"} · {search.hits.length} shown
              </p>

              {search.hits.length === 0 ? (
                <p className="px-1 text-[11.5px] text-mid">No code match.</p>
              ) : (
                <ul className="max-h-[30vh] overflow-y-auto text-[11.5px]">
                  {search.hits.map((hit) => (
                    <li key={hit.path}>
                      <Link
                        href={href(base, {
                          path: hit.path,
                          line: hit.line ? String(hit.line) : undefined,
                        })}
                        className="block truncate rounded px-1.5 py-1 font-mono text-body hover:bg-hover hover:text-hi"
                      >
                        {hit.path}
                        {hit.line ? `:${hit.line}` : ""}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <p className="px-1 pt-1 text-[10px] leading-relaxed text-low">
                GitHub searches the default branch; line numbers are resolved at{" "}
                {sha.slice(0, 7)}.
              </p>
            </section>
          )}
        </aside>

        <section className="min-w-0 space-y-2">
          {file ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate font-mono text-[12px] text-body">
                  {file.path}
                </p>
                <div className="flex items-center gap-3 text-[11px] text-low">
                  <span>{file.bytes.toLocaleString()} bytes</span>
                  {externalUrl && (
                    <a
                      href={externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-hi"
                    >
                      Open on GitHub
                    </a>
                  )}
                </div>
              </div>
              <CodeView text={file.text} highlight={line} />
            </>
          ) : fileError ? (
            <p
              role="alert"
              className="rounded-xl border border-line bg-card px-4 py-3 text-[12.5px] text-mid"
            >
              {fileError}
            </p>
          ) : (
            <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
              <p className="text-[13px] font-medium text-hi">Nothing open</p>
              <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-mid">
                Pick a file from the tree. Everything is read at {sha.slice(0, 7)},
                so the line numbers you see are the ones a diff will use.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
