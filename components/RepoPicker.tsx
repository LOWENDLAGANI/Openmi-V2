"use client";

import { GitFork, Lock, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { attachRepo, startFromTemplate } from "@/app/github/actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { RepoSummary } from "@/lib/github/types";
import { TEMPLATE_OPTIONS } from "@/lib/templates/options";

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
    <div className="space-y-4">
      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <Plus aria-hidden="true" className="size-4 text-accent-text" strokeWidth={1.75} />
          <h3 className="text-[14px] font-semibold text-hi">Start from a template</h3>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-mid">
          Creates a private repository with one initial commit and opens it in a
          pinned thread. Nothing is published publicly.
        </p>

        <form
          action={startFromTemplate}
          className="mt-4 flex flex-wrap items-end gap-2.5"
        >
          <label className="min-w-[180px] flex-1 text-[12px] font-medium text-mid">
            Repository name
            <input
              name="name"
              required
              placeholder="my-openmi-app"
              pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
              className="field mt-1.5 font-mono text-[12.5px]"
            />
          </label>

          <label className="text-[12px] font-medium text-mid">
            Template
            <select
              name="templateId"
              className="field mt-1.5"
              defaultValue={TEMPLATE_OPTIONS[0]?.id}
            >
              {TEMPLATE_OPTIONS.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · {template.files} files
                </option>
              ))}
            </select>
          </label>

          <SubmitButton className="btn btn-primary px-4 py-2 text-[12.5px]" optimisticText="Created">
            Create repository
          </SubmitButton>
        </form>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Filter ${repos.length} readable repositories…`}
          aria-label="Filter repositories"
          className="field min-w-0 flex-1"
        />
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as "pushed" | "name")}
          aria-label="Sort repositories"
          className="field w-auto"
        >
          <option value="pushed">Recently pushed</option>
          <option value="name">Name</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-[13px] leading-relaxed text-mid">
          No repository matches “{filter}”.
        </p>
      ) : (
        <ul className="panel divide-y divide-line overflow-hidden">
          {visible.slice(0, MAX_RENDERED).map((repo) => (
            <li
              key={repo.fullName}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-raised"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <GitFork aria-hidden="true" className="size-3.5 shrink-0 text-low" strokeWidth={1.75} />
                  <p className="truncate font-mono text-[13px] font-medium text-hi">
                    {repo.fullName}
                  </p>
                  {repo.private && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-raised px-1.5 py-0.5 text-[10.5px] font-medium text-mid">
                      <Lock aria-hidden="true" className="size-2.5" strokeWidth={2} />
                      private
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-[12px] text-low">
                  {repo.description ?? "No description"}
                  {repo.language ? ` · ${repo.language}` : ""}
                  {repo.pushedAt ? ` · pushed ${repo.pushedAt.slice(0, 10)}` : ""}
                </p>
              </div>

              <form action={attachRepo}>
                <input type="hidden" name="repo" value={repo.fullName} />
                {chatId && <input type="hidden" name="chat" value={chatId} />}
                <SubmitButton className="btn px-3.5 py-1.5 text-[12px]" optimisticText="Opened">
                  Open
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}

      {visible.length > MAX_RENDERED && (
        <p className="text-[11.5px] text-low">
          Showing the first {MAX_RENDERED} of {visible.length}.
        </p>
      )}
    </div>
  );
}
