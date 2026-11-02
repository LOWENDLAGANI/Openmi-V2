/**
 * A line diff, capped so a review card stays a review card.
 *
 * The diff is produced here rather than fetched: GitHub has a diff endpoint,
 * but a proposed edit does not exist anywhere yet, so there is nothing to
 * fetch. Two properties matter and are tested:
 *
 * 1. Every changed line appears. The edit script is a shortest edit script
 *    over lines, with three lines of context around each change.
 * 2. Truncation is visible. A diff over the caps is clipped and the text says
 *    so; nothing is quietly dropped. The counts and the stored edit itself stay
 *    complete, so a truncated card still describes the whole change.
 */

export const MAX_DIFF_CHARS = 60_000;
export const MAX_DIFF_LINES = 2_000;
export const DIFF_CONTEXT_LINES = 3;

export type DiffLineKind = " " | "+" | "-";

export type UnifiedDiff = {
  text: string;
  additions: number;
  deletions: number;
  /** Lines of diff text produced, excluding the truncation notice. */
  lines: number;
  truncated: boolean;
};

type Op = { kind: DiffLineKind; text: string };

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

/**
 * Myers' shortest edit script.
 *
 * `trace[d]` is the furthest-reaching path per diagonal before step `d`, which
 * is exactly what the backtrack needs: it walks the snake, then takes the one
 * edit that step introduced.
 */
function shortestEditScript(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());

    for (let k = -d; k <= d; k += 2) {
      const left = v[offset + k - 1];
      const right = v[offset + k + 1];
      let x: number;

      if (k === -d || (k !== d && left < right)) x = right;
      else x = left + 1;

      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) return backtrack(trace, a, b, offset);
    }
  }

  // Unreachable: a path always exists at d = n + m. Kept as an honest
  // fallback rather than an exception in a render path.
  return [
    ...a.map((text) => ({ kind: "-" as const, text })),
    ...b.map((text) => ({ kind: "+" as const, text })),
  ];
}

function backtrack(trace: Int32Array[], a: string[], b: string[], offset: number): Op[] {
  const edits: Op[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const left = v[offset + k - 1];
    const right = v[offset + k + 1];
    const prevK = k === -d || (k !== d && left < right) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : v[offset + prevK];
    const prevY = d === 0 ? 0 : prevX - prevK;

    while (x > prevX && y > prevY) {
      edits.push({ kind: " ", text: a[x - 1] });
      x -= 1;
      y -= 1;
    }

    if (d === 0) break;

    if (x === prevX) {
      edits.push({ kind: "+", text: b[y - 1] });
      y -= 1;
    } else {
      edits.push({ kind: "-", text: a[x - 1] });
      x -= 1;
    }
  }

  return edits.reverse();
}

type Hunk = { lines: string[] };

function buildHunks(ops: Op[], context: number): Hunk[] {
  const changed: number[] = [];
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index].kind !== " ") changed.push(index);
  }

  if (changed.length === 0) return [];

  // Line numbers before each op, so a hunk header can name both sides.
  const oldBefore = new Array<number>(ops.length + 1);
  const newBefore = new Array<number>(ops.length + 1);
  let oldLine = 1;
  let newLine = 1;

  for (let index = 0; index < ops.length; index += 1) {
    oldBefore[index] = oldLine;
    newBefore[index] = newLine;
    if (ops[index].kind === " ") {
      oldLine += 1;
      newLine += 1;
    } else if (ops[index].kind === "-") {
      oldLine += 1;
    } else {
      newLine += 1;
    }
  }
  oldBefore[ops.length] = oldLine;
  newBefore[ops.length] = newLine;

  const groups: Array<[number, number]> = [];
  let first = changed[0];
  let last = changed[0];

  for (const index of changed.slice(1)) {
    // Two changes share a hunk when the gap is small enough for their context
    // windows to touch.
    if (index - last <= 2 * context + 1) {
      last = index;
    } else {
      groups.push([first, last]);
      first = index;
      last = index;
    }
  }
  groups.push([first, last]);

  return groups.map(([start, end]) => {
    const from = Math.max(0, start - context);
    const to = Math.min(ops.length, end + context + 1);
    const slice = ops.slice(from, to);

    const originalCount = slice.filter((op) => op.kind !== "+").length;
    const newCount = slice.filter((op) => op.kind !== "-").length;
    const originalStart =
      originalCount === 0 ? Math.max(0, oldBefore[from] - 1) : oldBefore[from];
    const newStart = newCount === 0 ? Math.max(0, newBefore[from] - 1) : newBefore[from];

    const lines = [`@@ -${originalStart},${originalCount} +${newStart},${newCount} @@`];
    for (const op of slice) lines.push(`${op.kind}${op.text}`);

    return { lines };
  });
}

/**
 * A unified diff between two texts.
 *
 * `context` is exposed so the tests can ask for the whole file: with the full
 * script in one hunk, applying the diff must reproduce both sides exactly.
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  context: number = DIFF_CONTEXT_LINES
): UnifiedDiff {
  const ops = shortestEditScript(splitLines(oldText), splitLines(newText));
  const additions = ops.filter((op) => op.kind === "+").length;
  const deletions = ops.filter((op) => op.kind === "-").length;
  const hunks = buildHunks(ops, Math.max(0, context));

  const kept: string[] = [];
  let chars = 0;
  let truncated = false;

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (kept.length >= MAX_DIFF_LINES || chars + line.length + 1 > MAX_DIFF_CHARS) {
        truncated = true;
        break;
      }
      kept.push(line);
      chars += line.length + 1;
    }
    if (truncated) break;
  }

  const text = truncated
    ? `${kept.join("\n")}\n… diff truncated at ${MAX_DIFF_LINES.toLocaleString()} lines / ${MAX_DIFF_CHARS.toLocaleString()} characters. The proposed file is stored in full.`
    : kept.join("\n");

  return {
    text,
    additions,
    deletions,
    lines: kept.length,
    truncated,
  };
}
