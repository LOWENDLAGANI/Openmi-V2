import { randomBytes } from "node:crypto";

import { expect, test } from "bun:test";

import {
  CHANGESET_TTL_MS,
  MAX_CHANGESET_FILES,
  MAX_EDITS_PER_CALL,
  MAX_EDIT_BYTES,
  applyEdit,
  changesetContentHash,
  changesetDisplayStatus,
  changesetSignatureInput,
  signChangeset,
  validateEdits,
  verifyChangesetSignature,
  type EditRequest,
  type SignatureInput,
} from "../lib/changesets";
import { MAX_DIFF_CHARS, MAX_DIFF_LINES, unifiedDiff } from "../lib/diff";

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");

function side(diffText: string, kind: "old" | "new"): string {
  return diffText
    .split("\n")
    .filter((line) => !line.startsWith("@@"))
    .filter(
      (line) => line.startsWith(" ") || line.startsWith(kind === "old" ? "-" : "+")
    )
    .map((line) => line.slice(1))
    .join("\n");
}

test("the documented changeset caps are the exported constants", () => {
  expect(MAX_EDITS_PER_CALL).toBe(6);
  expect(MAX_EDIT_BYTES).toBe(120_000);
  expect(MAX_CHANGESET_FILES).toBe(24);
  expect(CHANGESET_TTL_MS).toBe(21_600_000);
  expect(MAX_DIFF_CHARS).toBe(60_000);
  expect(MAX_DIFF_LINES).toBe(2_000);
});

test("a whole-file write and an exact replacement both apply", () => {
  const written = applyEdit("old\n", {
    path: "a.ts",
    mode: "write",
    content: "new\n",
  });
  expect(written.ok).toBe(true);
  if (written.ok) expect(written.proposed).toBe("new\n");

  const replaced = applyEdit("const a = 1;\nconst b = 2;\n", {
    path: "a.ts",
    mode: "replace",
    find: "const b = 2;",
    replace: "const b = 3;",
  });
  expect(replaced.ok).toBe(true);
  if (replaced.ok) expect(replaced.proposed).toBe("const a = 1;\nconst b = 3;\n");
});

test("a replacement with no anchor fails that file and says why", () => {
  const missing = applyEdit("const a = 1;\n", {
    path: "a.ts",
    mode: "replace",
    find: "const b = 2;",
    replace: "const b = 3;",
  });

  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.error).toContain("not found");

  const missingFile = applyEdit(null, {
    path: "a.ts",
    mode: "replace",
    find: "anything",
    replace: "other",
  });
  expect(missingFile.ok).toBe(false);
  if (!missingFile.ok) expect(missingFile.error).toContain("does not exist");
});

test("an ambiguous anchor is refused rather than guessed at", () => {
  const result = applyEdit("same\nsame\n", {
    path: "a.ts",
    mode: "replace",
    find: "same",
    replace: "different",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("2 times");
});

test("an edit that changes nothing, or is over the cap, is refused", () => {
  const identical = applyEdit("same\n", {
    path: "a.ts",
    mode: "write",
    content: "same\n",
  });
  expect(identical.ok).toBe(false);

  const identicalReplace = applyEdit("same\n", {
    path: "a.ts",
    mode: "replace",
    find: "same",
    replace: "same",
  });
  expect(identicalReplace.ok).toBe(false);

  const oversized = applyEdit(null, {
    path: "a.ts",
    mode: "write",
    content: "x".repeat(MAX_EDIT_BYTES + 1),
  });
  expect(oversized.ok).toBe(false);
});

test("edit requests are validated before anything is read", () => {
  const edit = { path: "lib/a.ts", mode: "write", content: "x" };

  expect(validateEdits([edit]).ok).toBe(true);
  expect(validateEdits([]).ok).toBe(false);
  expect(validateEdits("nope").ok).toBe(false);

  const tooMany = Array.from({ length: MAX_EDITS_PER_CALL + 1 }, (_, index) => ({
    path: `lib/${index}.ts`,
    mode: "write",
    content: "x",
  }));
  expect(validateEdits(tooMany).ok).toBe(false);

  expect(validateEdits([{ ...edit, path: "../secrets" }]).ok).toBe(false);
  expect(validateEdits([{ ...edit, path: "/etc/passwd" }]).ok).toBe(false);
  expect(validateEdits([{ ...edit, path: ".git/config" }]).ok).toBe(false);
  expect(validateEdits([{ ...edit, url: "http://169.254.169.254" }]).ok).toBe(false);
  expect(validateEdits([edit, edit]).ok).toBe(false);
  expect(validateEdits([{ path: "a.ts", mode: "replace", find: "a" }]).ok).toBe(false);
  expect(validateEdits([{ path: "a.ts", mode: "remove" }]).ok).toBe(false);
});

test("a unified diff has a header, counts, and reproduces both sides", () => {
  const before = "one\ntwo\nthree\nfour\nfive\nsix\nseven";
  const after = "one\nthree\nfour\nFIVE\nsix\nseven\neight";

  const diff = unifiedDiff(before, after, 10);

  expect(diff.truncated).toBe(false);
  expect(diff.text).toContain("@@ -");
  expect(side(diff.text, "old")).toBe(before);
  expect(side(diff.text, "new")).toBe(after);
  expect(diff.additions).toBe(2);
  expect(diff.deletions).toBe(2);
});

test("context is bounded around a change", () => {
  const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
  const after = before.replace("line 10", "line ten");

  const diff = unifiedDiff(before, after);

  expect(diff.text.startsWith("@@ -7,7 +7,7 @@")).toBe(true);
  expect(diff.additions).toBe(1);
  expect(diff.deletions).toBe(1);
});

test("a diff over the character cap is clipped and says so", () => {
  const before = "a".repeat(MAX_DIFF_CHARS + 1);
  const after = "b".repeat(MAX_DIFF_CHARS + 1);

  const diff = unifiedDiff(before, after);

  expect(diff.truncated).toBe(true);
  expect(diff.text).toContain("diff truncated");
  expect(diff.text.length).toBeLessThan(MAX_DIFF_CHARS + 300);
});

test("a diff over the line cap is clipped and says so", () => {
  const before = Array.from({ length: MAX_DIFF_LINES + 100 }, (_, index) => `old ${index}`);
  const after = Array.from({ length: MAX_DIFF_LINES + 100 }, (_, index) => `new ${index}`);

  const diff = unifiedDiff(before.join("\n"), after.join("\n"));

  expect(diff.truncated).toBe(true);
  expect(diff.lines).toBe(MAX_DIFF_LINES);
  expect(diff.text).toContain("diff truncated");
  expect(diff.additions).toBe(before.length);
  expect(diff.deletions).toBe(before.length);
});

test("the content hash ignores order and changes when a file is dropped", () => {
  const files = [
    { path: "b.ts", proposed: "b" },
    { path: "a.ts", proposed: "a" },
  ];

  const first = changesetContentHash(files);
  const reordered = changesetContentHash([...files].reverse());

  expect(first).toBe(reordered);
  expect(changesetContentHash([files[0]])).not.toBe(first);
  expect(changesetContentHash([{ ...files[0], proposed: "b " }])).not.toBe(first);
});

test("the signature refuses a changed byte, a changed id and another key", () => {
  const baseSha = "a".repeat(40);
  const contentHash = changesetContentHash([{ path: "a.ts", proposed: "a" }]);
  const input = { changesetId: "changeset-1", baseSha, contentHash };
  const signature = signChangeset(input, KEY);

  expect(verifyChangesetSignature(input, signature, KEY)).toBe(true);
  expect(
    verifyChangesetSignature({ ...input, contentHash: `${contentHash}0` }, signature, KEY)
  ).toBe(false);
  expect(
    verifyChangesetSignature({ ...input, changesetId: "changeset-2" }, signature, KEY)
  ).toBe(false);
  expect(verifyChangesetSignature(input, signature, OTHER_KEY)).toBe(false);
  expect(verifyChangesetSignature(input, "not-a-signature", KEY)).toBe(false);
});

test("status is outside the signature, so approving does not invalidate it", () => {
  const baseSha = "b".repeat(40);
  const contentHash = changesetContentHash([{ path: "a.ts", proposed: "a" }]);
  const input = { changesetId: "changeset-1", baseSha, contentHash };
  const signature = signChangeset(input, KEY);

  const approved: SignatureInput & { status: string } = { ...input, status: "approved" };

  expect(verifyChangesetSignature(approved, signature, KEY)).toBe(true);
  expect(changesetSignatureInput(input)).not.toContain("status");
});

test("a card shows expired from the clock, not from a hopeful status", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 1000).toISOString();

  expect(changesetDisplayStatus({ status: "ready", expires_at: past })).toBe("expired");
  expect(changesetDisplayStatus({ status: "approved", expires_at: past })).toBe("expired");
  expect(changesetDisplayStatus({ status: "ready", expires_at: future })).toBe("ready");
  expect(changesetDisplayStatus({ status: "failed", expires_at: past })).toBe("failed");
  expect(changesetDisplayStatus({ status: "committed", expires_at: past })).toBe("committed");
});

test("a write is allowed for a file that does not exist yet", () => {
  const created = applyEdit(null, {
    path: "docs/new.md",
    mode: "write",
    content: "# New\n",
  });

  expect(created.ok).toBe(true);
  if (created.ok) expect(created.proposed).toBe("# New\n");
});

test("the edit type keeps replacement fields optional", () => {
  const edit: EditRequest = { path: "a.ts", mode: "write", content: "a" };
  expect(edit.mode).toBe("write");
});
