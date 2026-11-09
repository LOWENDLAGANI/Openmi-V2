import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { parseSealKey } from "./crypto";

/**
 * Proposed edits: what they may contain, and how they are proven.
 *
 * Nothing in this module touches GitHub, a database or the network. It decides
 * whether an edit is well-formed, applies it to a known base text, and signs
 * the result. That split is deliberate: the acceptance rules can be tested
 * without a Supabase project, and the signing input has exactly one definition.
 *
 * The signature covers `changeset_id + base_sha + content_hash` and nothing
 * else. `status` is excluded on purpose: moving a changeset from ready to
 * approved is a review act, not a content change, so it must not invalidate
 * the signature. Editing one byte of a proposed file changes the hash, which
 * changes the signature, which is refused.
 */

export const MAX_EDITS_PER_CALL = 6;
export const MAX_EDIT_BYTES = 120_000;
export const MAX_CHANGESET_FILES = 24;
export const CHANGESET_TTL_MS = 6 * 60 * 60 * 1000;

export type EditMode = "write" | "replace";

export type ChangesetStatus =
  | "draft"
  | "ready"
  | "approved"
  | "committed"
  | "failed"
  | "expired"
  | "reverted"
  | "rejected";

export type EditRequest = {
  path: string;
  mode: EditMode;
  content?: string;
  find?: string;
  replace?: string;
};

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * A repository-relative path, or null.
 *
 * Checked before any read or write: a proposal cannot name a traversal, an
 * absolute path, a URL, or the git metadata directory.
 */
export function safeRepoPath(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const path = value.trim();
  if (path.length === 0 || path.length > 400) return null;
  if (path.startsWith("/") || path.includes("..") || path.includes("\\")) return null;
  if (path.includes("://")) return null;
  if (path === ".git" || path.startsWith(".git/")) return null;

  return path;
}

const EDIT_KEYS = ["path", "mode", "content", "find", "replace"];

export type EditValidation =
  | { ok: true; edits: EditRequest[] }
  | { ok: false; error: string };

/**
 * Validates one propose_edits call before anything is read or stored.
 *
 * The caps are enforced here rather than in the prompt: a model that ignores
 * them gets a typed error it can read, not a silent truncation.
 */
export function validateEdits(value: unknown): EditValidation {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: "edits must be a non-empty array" };
  }

  if (value.length > MAX_EDITS_PER_CALL) {
    return {
      ok: false,
      error: `a call proposes at most ${MAX_EDITS_PER_CALL} edits; split the change into several calls`,
    };
  }

  const edits: EditRequest[] = [];

  for (const [index, raw] of value.entries()) {
    const label = `edit ${index + 1}`;

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `${label} is not an object` };
    }

    const record = raw as Record<string, unknown>;
    const extra = Object.keys(record).find((key) => !EDIT_KEYS.includes(key));
    if (extra) return { ok: false, error: `${label} has an unexpected field: ${extra}` };

    const path = safeRepoPath(record.path);
    if (!path) {
      return { ok: false, error: `${label} needs a repository-relative path` };
    }

    if (record.mode === "write") {
      if (typeof record.content !== "string") {
        return { ok: false, error: `${label} is a write, so content is required` };
      }
      if (byteLength(record.content) > MAX_EDIT_BYTES) {
        return {
          ok: false,
          error: `${label} is over the ${MAX_EDIT_BYTES.toLocaleString()} byte cap per edit`,
        };
      }
      if (record.find !== undefined || record.replace !== undefined) {
        return { ok: false, error: `${label} mixes write with replacement fields` };
      }

      edits.push({ path, mode: "write", content: record.content });
      continue;
    }

    if (record.mode === "replace") {
      if (typeof record.find !== "string" || record.find.length === 0) {
        return { ok: false, error: `${label} needs the exact text to find` };
      }
      if (typeof record.replace !== "string") {
        return { ok: false, error: `${label} needs the replacement text` };
      }
      if (byteLength(record.replace) > MAX_EDIT_BYTES) {
        return {
          ok: false,
          error: `${label} is over the ${MAX_EDIT_BYTES.toLocaleString()} byte cap per edit`,
        };
      }
      if (record.content !== undefined) {
        return { ok: false, error: `${label} mixes replace with whole-file content` };
      }

      edits.push({
        path,
        mode: "replace",
        find: record.find,
        replace: record.replace,
      });
      continue;
    }

    return { ok: false, error: `${label} needs mode "write" or "replace"` };
  }

  const paths = new Set(edits.map((edit) => edit.path));
  if (paths.size !== edits.length) {
    return { ok: false, error: "a file may be proposed once per call" };
  }

  return { ok: true, edits };
}

export type EditOutcome =
  | { ok: true; proposed: string }
  | { ok: false; error: string };

/**
 * Applies one edit to the text at the base commit.
 *
 * `original` is null when the path does not exist there. A replacement against
 * a missing file fails that file with a message rather than guessing at an
 * anchor, and a repeated anchor fails rather than picking one of them.
 */
export function applyEdit(original: string | null, edit: EditRequest): EditOutcome {
  if (edit.mode === "write") {
    const proposed = edit.content ?? "";

    if (byteLength(proposed) > MAX_EDIT_BYTES) {
      return {
        ok: false,
        error: `the proposed file is over the ${MAX_EDIT_BYTES.toLocaleString()} byte cap`,
      };
    }

    if (original !== null && original === proposed) {
      return { ok: false, error: "the proposed content is identical to the file at the base commit" };
    }

    return { ok: true, proposed };
  }

  if (original === null) {
    return {
      ok: false,
      error: "the file does not exist at the base commit, so there is no anchor to replace",
    };
  }

  const find = edit.find ?? "";
  const replacement = edit.replace ?? "";

  if (find.length === 0) {
    return { ok: false, error: "the anchor is empty" };
  }

  const occurrences = original.split(find).length - 1;

  if (occurrences === 0) {
    return { ok: false, error: "the anchor was not found at the base commit" };
  }

  if (occurrences > 1) {
    return {
      ok: false,
      error: `the anchor appears ${occurrences} times; include more surrounding context so the replacement is unambiguous`,
    };
  }

  const proposed = original.replace(find, replacement);

  if (proposed === original) {
    return { ok: false, error: "the replacement leaves the file unchanged" };
  }

  if (byteLength(proposed) > MAX_EDIT_BYTES) {
    return {
      ok: false,
      error: `the edited file would be over the ${MAX_EDIT_BYTES.toLocaleString()} byte cap`,
    };
  }

  return { ok: true, proposed };
}

/**
 * A hash of the accepted files, in path order.
 *
 * Rejecting a file removes it from the set, which changes the hash and forces
 * a fresh signature; editing a byte changes it too. Order in the database is
 * not part of the contract, so the hash sorts before hashing.
 */
export function changesetContentHash(
  files: Array<{ path: string; proposed: string }>
): string {
  const canonical = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `${file.path}\u0000${file.proposed}`)
    .join("\u0000");

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export type SignatureInput = {
  changesetId: string;
  baseSha: string;
  contentHash: string;
};

export function changesetSignatureInput(input: SignatureInput): string {
  return `${input.changesetId}\n${input.baseSha}\n${input.contentHash}`;
}

function signingKey(base64Key: string): Buffer {
  return createHmac("sha256", parseSealKey(base64Key))
    .update("openmi:changeset:v1")
    .digest();
}

export function signChangeset(input: SignatureInput, base64Key: string): string {
  return createHmac("sha256", signingKey(base64Key))
    .update(changesetSignatureInput(input))
    .digest("base64url");
}

export function verifyChangesetSignature(
  input: SignatureInput,
  signature: string,
  base64Key: string
): boolean {
  let expected: Buffer;
  let actual: Buffer;

  try {
    expected = Buffer.from(signChangeset(input, base64Key), "base64url");
    actual = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }

  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * The status a card may show, derived from an observation rather than stored.
 *
 * Expiry is a clock fact, so a row that still says `ready` after its TTL is
 * presented — and refused — as expired. `expired` is also a legal stored value
 * so phase 6 can settle rows without a migration.
 */
export function changesetDisplayStatus(
  changeset: { status: ChangesetStatus; expires_at: string },
  now: number = Date.now()
): ChangesetStatus {
  if (
    (changeset.status === "draft" ||
      changeset.status === "ready" ||
      changeset.status === "approved") &&
    new Date(changeset.expires_at).getTime() < now
  ) {
    return "expired";
  }

  return changeset.status;
}
