/**
 * The text a replacement edit actually swapped.
 *
 * A changeset file stores the content at the base commit and the proposed
 * content, not the anchor the model typed. Deriving the anchor from the two
 * texts is the one definition every re-application uses: the approval, the
 * re-apply on a moved default head, and the sandbox rebase. A pure insertion has
 * no anchor, so it is reported as not re-appliable rather than guessed at.
 *
 * Pure on purpose: no database, no network, no `server-only`.
 */

/**
 * The longest unchanged prefix and suffix are removed, leaving the exact text the
 * edit replaced.
 */
export function deriveReplacement(
  original: string,
  proposed: string
): { find: string; replace: string } | null {
  if (original === proposed) return null;

  const shortest = Math.min(original.length, proposed.length);
  let start = 0;

  while (start < shortest && original[start] === proposed[start]) start += 1;

  let oldEnd = original.length;
  let newEnd = proposed.length;

  while (
    oldEnd > start &&
    newEnd > start &&
    original[oldEnd - 1] === proposed[newEnd - 1]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const find = original.slice(start, oldEnd);
  const replace = proposed.slice(start, newEnd);

  return find.length === 0 ? null : { find, replace };
}

/** Applies an exact-string replacement only when it matches exactly once. */
export function replaceOnce(
  text: string,
  find: string,
  replace: string
): string | null {
  if (find.length === 0) return null;
  if (text.split(find).length - 1 !== 1) return null;
  return text.replace(find, replace);
}
