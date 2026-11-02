"use client";

import { useMemo, useState } from "react";

import { attachRepo } from "@/app/github/actions";
import type { RepoSummary } from "@/lib/github/types";

const MAX_RENDERED = 100;

export function RepoPicker({
  repos,
  chatId,
}: {
  repos: RepoSummary[];
  chatId?: string;
}) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"pushed" | "name">("pushed");

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matches = needle
      ? repos.filter((repo) => repo.fullName.toLowerCase().includes(needle))
      : repos;

    return [...matches].sort((a, b) =>
      sort === "name"
        ? a.fullName.localeCompare(b.fullName)
        : (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "")
    );
  }, [repos, filter, sort]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Filter ${repos.length} readable repositories`}
          aria-label="Filter repositories"
          className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-[13px] text-body placeholder:text-low"
        />
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as "pushed" | "name")}
          aria-label="Sort repositories"
          className="rounded-lg border border-line bg-card px-2 py-2 text-[12px] text-body"
        >
          <option value="pushed">Recently pushed</option>
          <option value="name">Name</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 text-[13px] text-mid">
          No repository matches “{filter}”. The list only contains repositories
          this token can read, so a missing repo is a token scope, not a bug.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {visible.slice(0, MAX_RENDERED).map((repo) => (
            <li
              key={repo.fullName}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-[13px] font-medium text-hi">
                  {repo.fullName}
                  {repo.private && (
                    <span className="rounded-full border border-line bg-chip px-2 py-0.5 text-[10px] font-normal uppercase tracking-[0.1em] text-mid">
                      Private
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[11.5px] text-low">
                  {repo.description ?? "No description"}
                  {repo.language ? ` · ${repo.language}` : ""}
                  {repo.pushedAt ? ` · pushed ${repo.pushedAt.slice(0, 10)}` : ""}
                </p>
              </div>

              <form action={attachRepo}>
                <input type="hidden" name="repo" value={repo.fullName} />
                {chatId && <input type="hidden" name="chat" value={chatId} />}
                <button className="rounded-lg border border-line bg-raised px-3 py-1.5 text-[12px] font-medium text-body hover:bg-hover">
                  Open
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {visible.length > MAX_RENDERED && (
        <p className="mt-3 text-[11px] text-low">
          Showing the first {MAX_RENDERED} of {visible.length}. Filter to narrow
          the list.
        </p>
      )}
    </div>
  );
}
