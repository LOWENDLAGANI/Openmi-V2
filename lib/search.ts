/**
 * Search rules for the command palette.
 *
 * The query never reaches SQL as-is: `%` and `_` are wildcards in Postgres
 * `ilike`, so a reader typing "50%" would otherwise match everything. These
 * helpers are pure so the rules are testable without a database.
 */

export const MIN_QUERY_CHARS = 2;
export const MAX_QUERY_CHARS = 80;
export const MAX_RESULTS = 12;

/** Escapes the two characters `ilike` treats as wildcards. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * A one-line window around the first match, so a result shows the part of the
 * message that matched instead of its first 100 characters.
 */
export function snippetAround(content: string, query: string, radius = 70): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";

  const index = flat.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) {
    return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat;
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(flat.length, index + query.length + radius);

  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}
