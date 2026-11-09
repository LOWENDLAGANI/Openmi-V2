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

test("the chat page shows the read failure instead of nothing", () => {
  const source = page();

  expect(source).toContain("proposals.error ?");
  expect(source).toContain("role=\"alert\"");
  expect(source).toContain("Your proposals could not be loaded.");
  expect(source).toContain("{proposals.error}");
});

test("the page still renders the panel when there are proposals", () => {
  const source = page();

  expect(source).toContain("proposals.changesets.length > 0");
  expect(source).toContain("<ReviewPanel");
  expect(source).toContain("changesets={proposals.changesets}");
});
