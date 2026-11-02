/**
 * Context assembly for one turn.
 *
 * The budget is a character count rather than a token estimate because it has
 * to be explainable: the UI shows characters used against characters allowed,
 * and the notes say exactly what was trimmed. A token guess would make the
 * meter a decoration.
 *
 * The rule that matters: the file the user has open is never trimmed away. It
 * is the thing they are asking about. If it alone exceeds the budget, it is
 * kept and the notes say why nothing else was added.
 */

export const MAX_CONTEXT_CHARS = 60_000;
export const MAX_TREE_PATHS = 400;

export type ContextFile = { path: string; text: string };

export type ContextBudget = {
  text: string;
  usedChars: number;
  budgetChars: number;
  notes: string[];
  pinnedIncluded: boolean;
};

export function assembleContext({
  paths,
  pinned,
  budget = MAX_CONTEXT_CHARS,
}: {
  paths: string[];
  pinned: ContextFile | null;
  budget?: number;
}): ContextBudget {
  const notes: string[] = [];
  const blocks: string[] = [];

  let pinnedIncluded = false;

  if (pinned) {
    blocks.push(`### ${pinned.path}\n\n${pinned.text}`);
    pinnedIncluded = true;

    if (pinned.text.length + pinned.path.length + 8 > budget) {
      notes.push(
        `The open file alone is larger than the ${budget.toLocaleString()} character budget. It was kept, and nothing else was added.`
      );
    }
  }

  const remaining = budget - blocks.join("\n\n").length;

  if (paths.length === 0) {
    notes.push("No repository tree was available for this turn.");
  } else if (remaining <= 200) {
    notes.push(
      pinned
        ? "The repository path list was left out: the open file used the whole budget."
        : "The repository path list was left out: the budget was already spent."
    );
  } else {
    const listed = paths.slice(0, MAX_TREE_PATHS);
    const header = "### Repository paths\n\n";
    const perPath = Math.ceil(
      listed.reduce((total, path) => total + path.length + 1, 0) / Math.max(listed.length, 1)
    );
    const room = Math.max(0, Math.floor((remaining - header.length) / Math.max(perPath, 1)));
    const kept = listed.slice(0, room);
    const block = `${header}${kept.join("\n")}`;

    blocks.push(block);

    if (kept.length < paths.length) {
      notes.push(
        `The path list was trimmed to ${kept.length} of ${paths.length} paths to stay inside the budget.`
      );
    }

    if (paths.length > MAX_TREE_PATHS && kept.length === listed.length) {
      notes.push(
        `Only the first ${MAX_TREE_PATHS} paths were listed, out of ${paths.length}.`
      );
    }
  }

  const text = blocks.join("\n\n");

  return {
    text,
    usedChars: text.length,
    budgetChars: budget,
    notes,
    pinnedIncluded,
  };
}
