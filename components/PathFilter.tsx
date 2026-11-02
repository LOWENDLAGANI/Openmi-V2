"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const MAX_MATCHES = 25;

/**
 * Instant path filter over the tree that was already fetched.
 *
 * It is a client component because "instant" means as-you-type, and re-fetching
 * a recursive tree per keystroke would be both slower and rate-limited. The
 * code search beside it is a server round trip, because that one is a GitHub
 * API call.
 */
export function PathFilter({
  paths,
  truncated,
  repo,
  branch,
  sha,
  chatId,
}: {
  paths: string[];
  truncated: boolean;
  repo: string;
  branch: string;
  sha: string;
  chatId?: string;
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    return paths
      .filter((path) => path.toLowerCase().includes(needle))
      .slice(0, MAX_MATCHES);
  }, [paths, query]);

  function hrefFor(path: string): string {
    const params = new URLSearchParams({ repo, branch, sha, path });
    if (chatId) params.set("chat", chatId);
    return `/chat?${params.toString()}`;
  }

  return (
    <div className="rounded-xl border border-line bg-card p-2">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter by path"
        aria-label="Filter files by path"
        className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] text-body placeholder:text-low"
      />

      {query.trim().length > 0 && (
        matches.length === 0 ? (
          <p className="px-1 pt-1.5 text-[11px] text-mid">No path matches.</p>
        ) : (
          <ul className="mt-1.5 max-h-[30vh] overflow-y-auto text-[11.5px]">
            {matches.map((path) => (
              <li key={path}>
                <Link
                  href={hrefFor(path)}
                  className="block truncate rounded px-1.5 py-1 font-mono text-body hover:bg-hover hover:text-hi"
                >
                  {path}
                </Link>
              </li>
            ))}
          </ul>
        )
      )}

      {truncated && (
        <p className="px-1 pt-1 text-[10px] leading-relaxed text-low">
          Filtering the first {paths.length} paths in this commit.
        </p>
      )}
    </div>
  );
}
