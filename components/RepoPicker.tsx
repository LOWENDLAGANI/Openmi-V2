"use client";

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
    <div>
      <section className="panel mb-4 p-4">
        <p className="eyebrow">start from a template</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-mid">
          Creates a private repository in your account with one commit, then
          opens a chat pinned to it. Nothing is published.
        </p>

        <form
          action={startFromTemplate}
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <label className="min-w-0 flex-1 text-[11px] text-mid">
            Repository name
            <input
              name="name"
              required
              placeholder="my-openmi-app"
              pattern="[A-Za-z0-9][A-Za-z0-9._-]*"
              className="field mt-1"
            />
          </label>

          <label className="text-[11px] text-mid">
            Template
            <select name="templateId" className="field mt-1" defaultValue={TEMPLATE_OPTIONS[0]?.id}>
              {TEMPLATE_OPTIONS.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · {template.files} files
                </option>
              ))}
            </select>
          </label>

          <SubmitButton className="btn px-4 py-1.5 text-[12px]" pendingText="Creating…">
            Create
          </SubmitButton>
        </form>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Filter ${repos.length} readable repositories`}
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
        <p className="mt-6 text-[13px] leading-relaxed text-mid">
          No repository matches “{filter}”.
        </p>
      ) : (
        <ul className="panel mt-4 divide-y divide-line overflow-hidden">
          {visible.slice(0, MAX_RENDERED).map((repo) => (
            <li
              key={repo.fullName}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-raised"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-[13.5px] font-medium text-hi">
                  {repo.fullName}
                  {repo.private && (
                    <span className="eyebrow rounded-full bg-chip px-2 py-0.5">
                      private
                    </span>
                  )}
                </p>
                <p className="mt-1 truncate text-[11.5px] text-low">
                  {repo.description ?? "No description"}
                  {repo.language ? ` · ${repo.language}` : ""}
                  {repo.pushedAt ? ` · pushed ${repo.pushedAt.slice(0, 10)}` : ""}
                </p>
              </div>

              <form action={attachRepo}>
                <input type="hidden" name="repo" value={repo.fullName} />
                {chatId && <input type="hidden" name="chat" value={chatId} />}
                <SubmitButton className="btn px-4 py-1.5 text-[12px]" pendingText="Opening…">
                  Open
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}

      {visible.length > MAX_RENDERED && (
        <p className="mt-3 text-[11px] text-low">
          Showing the first {MAX_RENDERED} of {visible.length}.
        </p>
      )}
    </div>
  );
}
