import { expect, test } from "bun:test";

import {
  EDITOR_MAX_BYTES,
  editorPath,
  filesEnabled,
  isProbablyBinary,
  relativeToWorkspace,
  textFitsWorkspaceFile,
} from "../lib/files/plan";

/**
 * The editor's only real security boundary: a path.
 *
 * A save is a write into a machine the reader owns, so the rule that matters is
 * that the path cannot leave the repository. These cases are the ones a route
 * handler would otherwise have to remember.
 */

test("only repository-relative paths are accepted", () => {
  for (const good of ["app/page.tsx", "./lib/a.ts", "README.md", "a/b/c.txt"]) {
    expect(editorPath(good)).toBe(good.replace(/^\.\//, ""));
  }

  for (const bad of [
    "",
    "   ",
    "/etc/passwd",
    "../secrets",
    "a/../../b",
    ".git/config",
    "https://example.com/x",
    "a\\b",
    "openmi-workspace/app/page.tsx",
    null,
    42,
  ]) {
    expect(editorPath(bad)).toBeNull();
  }
});

test("the byte cap is measured in UTF-8 bytes, not characters", () => {
  expect(textFitsWorkspaceFile("")).toBe(true);
  expect(textFitsWorkspaceFile("a".repeat(EDITOR_MAX_BYTES))).toBe(true);
  expect(textFitsWorkspaceFile("a".repeat(EDITOR_MAX_BYTES + 1))).toBe(false);

  // A multibyte character can push a short-looking string over the cap.
  expect(textFitsWorkspaceFile("é".repeat(EDITOR_MAX_BYTES / 2 + 1))).toBe(false);
});

test("a NUL byte is what makes a file binary", () => {
  expect(isProbablyBinary("export const a = 1;\n")).toBe(false);
  expect(isProbablyBinary("text\u0000more")).toBe(true);
});

test("a listing line becomes the path git would call it", () => {
  expect(relativeToWorkspace("openmi-workspace/app/page.tsx", "openmi-workspace")).toBe(
    "app/page.tsx"
  );
  expect(relativeToWorkspace("  openmi-workspace/README.md  ", "openmi-workspace")).toBe(
    "README.md"
  );
  expect(relativeToWorkspace("openmi-workspace", "openmi-workspace")).toBeNull();
  expect(relativeToWorkspace("", "openmi-workspace")).toBeNull();
  expect(relativeToWorkspace("other/file.ts", "openmi-workspace")).toBe("other/file.ts");
});

test("the editor exists only where a workspace can", () => {
  expect(filesEnabled({})).toBe(false);
  expect(filesEnabled({ E2B_API_KEY: "k" })).toBe(true);
  expect(filesEnabled({ E2B_API_KEY: "k", EXECUTION_ENABLED: "off" })).toBe(false);
});
