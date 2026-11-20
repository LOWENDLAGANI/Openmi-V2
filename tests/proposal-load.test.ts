import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The loader is `server-only`, so these are contract tests over its source and
 * the page that consumes it — the same style as tests/chat-env-provider.test.ts.
 *
 * What they pin: a failed read comes back as an error and the chat page shows
 * it, instead of both looking exactly like a chat with no proposals. That
 * silence is what made a stored change look like one the assistant never made.
 */

const store = () => readFileSync("lib/changesets/store.ts", "utf8");
const page = () => readFileSync("app/chat/page.tsx", "utf8");

test("the changeset select keeps its error instead of discarding it", () => {
  const source = store();

  expect(source).toContain("const { data: rows, error } = await supabase");
  expect(source).toContain(
    "if (error) return { changesets: [], error: error.message };"
  );
});

test("the files read is reported too, not rendered as a diff-less card", () => {
  const source = store();

  expect(source).toContain("error: filesError");
  expect(source).toContain(
    "if (filesError) return { changesets: [], error: filesError.message };"
  );
});

test("the loader returns a result, so success can be told from failure", () => {
  const source = store();

  expect(source).toContain("export type ChangesetLoad");
  expect(source).toContain("error: string | null");
  expect(source).toContain("Promise<ChangesetLoad>");
});

test("the chat page carries no review card above the transcript", () => {
  const source = page();

  // The write is the run's, decided when the turn ends, and the transcript says
  // what happened. There is no card to read and no read whose failure has to be
  // reported in the column.
  expect(source).not.toContain("<ReviewPanel");
  expect(source).not.toContain("loadChangesets");
  expect(source).not.toContain("proposals.error");
  expect(source).toContain("<ChatPanel");
});
