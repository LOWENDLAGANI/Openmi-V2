/**
 * What a template may be, before GitHub is called.
 *
 * Pure on purpose: a repository name is user input that ends up in an API path,
 * and a template's files end up in a commit. Both are checked here so the
 * creation call receives only values this module approved.
 */

import type { TemplateFile } from "./catalogue";

/** GitHub's own ceiling for a repository name. */
export const TEMPLATE_MAX_NAME_CHARS = 100;

/** A template is a starter, not a codebase. Matches the commit file cap. */
export const TEMPLATE_MAX_FILES = 24;

/** One file in a template is a source file, not a bundled asset. */
export const TEMPLATE_MAX_FILE_BYTES = 120_000;

/**
 * A repository name GitHub will accept: alphanumerics, dash, underscore, dot,
 * starting with a letter or number, and not a bare `.` or `..`.
 */
export function isTemplateRepoName(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const name = value.trim();
  if (name.length === 0 || name.length > TEMPLATE_MAX_NAME_CHARS) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return false;
  if (name === "." || name === "..") return false;

  return !name.toLowerCase().endsWith(".git");
}

/** A template id is a slug; existence is a catalogue lookup, not a pattern. */
export function isTemplateId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value);
}

/** One path git will accept inside a commit, and that cannot escape the repo. */
export function isTemplatePath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > 400) return false;
  if (path.startsWith("/") || path.includes("..") || path.includes("\\")) return false;
  if (path.includes("://")) return false;

  return path !== ".git" && !path.startsWith(".git/");
}

/**
 * Whether a template is safe to commit as it stands.
 *
 * Every rule is a refusal rather than a repair: a template that is too large or
 * has a path leaving the repository is a deployment bug, and shipping a truncated
 * version of it would be a worse one.
 */
export function templateFilesValid(files: readonly TemplateFile[]): boolean {
  if (files.length === 0 || files.length > TEMPLATE_MAX_FILES) return false;

  const seen = new Set<string>();

  for (const file of files) {
    if (!isTemplatePath(file.path)) return false;
    if (seen.has(file.path)) return false;
    seen.add(file.path);

    if (Buffer.byteLength(file.content, "utf8") > TEMPLATE_MAX_FILE_BYTES) {
      return false;
    }
  }

  return true;
}
