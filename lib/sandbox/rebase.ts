import "server-only";

import { safeRepoPath } from "@/lib/changesets";
import { deriveReplacement, replaceOnce } from "@/lib/changesets/replacement";
import { fetchRepoArchive } from "@/lib/execution/archive";
import { createSandbox, type SandboxHandle } from "@/lib/execution/provider";
import { isRepoFullName } from "@/lib/github/read";

/**
 * Reproducing a proposed change on a newer commit, inside a sandbox.
 *
 * The suggestion was computed against `baseSha`; the default branch has moved to
 * `newHead`. Both commits arrive as read-only GitHub archives — the same single
 * authenticated GET the workspace seed uses — so the box never holds a token,
 * has no remote and cannot authenticate anything. It reads, it writes files on
 * its own disk, and it reports text back. Nothing leaves the box.
 *
 * The edit is applied twice on purpose. First onto a checkout of `baseSha`, where
 * the anchor the suggestion was derived from must still match exactly once: a
 * change that cannot reproduce what was reviewed is refused before the newer code
 * is touched. Then the same exact substitution is applied to `newHead`, which is
 * the re-apply the caller writes out. A whole-file write needs no anchor and
 * simply replaces the path at both commits.
 */

export type RebaseFile = {
  path: string;
  mode: "write" | "replace";
  original: string | null;
  proposed: string;
};

export type RebaseResult =
  | { ok: true; files: Array<{ path: string; content: string }> }
  | { ok: false; reason: string };

const REBASE_DIR = "openmi-rebase";

/** One text file's ceiling, matching what a proposal may carry. */
const READ_BYTES = 400_000;

function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

function messageOf(caught: unknown): string {
  return caught instanceof Error && caught.message.length > 0
    ? caught.message
    : "The change could not be re-applied.";
}

async function readWorkspaceFile(
  sandbox: SandboxHandle,
  path: string
): Promise<string | null> {
  try {
    return await sandbox.readText(path, READ_BYTES);
  } catch {
    return null;
  }
}

export async function rebaseChangeset(input: {
  /** Opened by the caller for this one call, and used for reads only. */
  token: string;
  repo: string;
  baseSha: string;
  newHead: string;
  files: RebaseFile[];
}): Promise<RebaseResult> {
  if (input.files.length === 0) {
    return { ok: false, reason: "There is nothing to re-apply." };
  }

  if (!isRepoFullName(input.repo)) {
    return { ok: false, reason: "That repository name is not valid." };
  }

  if (!isCommitSha(input.baseSha) || !isCommitSha(input.newHead)) {
    return { ok: false, reason: "That commit is not valid." };
  }

  for (const file of input.files) {
    if (!safeRepoPath(file.path)) {
      return { ok: false, reason: `${file.path} is not a repository path.` };
    }
  }

  const [base, head] = await Promise.all([
    fetchRepoArchive({ token: input.token, repo: input.repo, sha: input.baseSha }),
    fetchRepoArchive({ token: input.token, repo: input.repo, sha: input.newHead }),
  ]);

  if (!base.ok) return { ok: false, reason: base.detail };
  if (!head.ok) return { ok: false, reason: head.detail };

  let sandbox: SandboxHandle | null = null;

  try {
    sandbox = await createSandbox(`rebase-${input.newHead.slice(0, 12)}`, {
      ttlMinutes: 10,
      labels: { kind: "rebase" },
    });

    await sandbox.upload(base.bytes, `${REBASE_DIR}/base.tgz`);
    await sandbox.upload(head.bytes, `${REBASE_DIR}/head.tgz`);

    const unpacked = await sandbox.exec(
      [
        `mkdir -p ${REBASE_DIR}/base ${REBASE_DIR}/head`,
        `tar xzf ${REBASE_DIR}/base.tgz -C ${REBASE_DIR}/base`,
        `tar xzf ${REBASE_DIR}/head.tgz -C ${REBASE_DIR}/head`,
        `rm -f ${REBASE_DIR}/base.tgz ${REBASE_DIR}/head.tgz`,
      ].join(" && "),
      ".",
      120_000
    );

    if (unpacked.exitCode !== 0) {
      return {
        ok: false,
        reason:
          unpacked.output.length > 0
            ? unpacked.output
            : "The code could not be checked out.",
      };
    }

    // A checkout of the reviewed commit, with its own history so the files have
    // a fixed point to be compared against.
    const baseCommit = await sandbox.exec(
      [
        "git init -q .",
        "git config user.name Openmi",
        "git config user.email openmi@users.noreply.github.com",
        "git add -A",
        "git -c commit.gpgsign=false commit -qm base",
      ].join(" && "),
      `${REBASE_DIR}/base`,
      120_000
    );

    if (baseCommit.exitCode !== 0) {
      return {
        ok: false,
        reason:
          baseCommit.output.length > 0
            ? baseCommit.output
            : "The suggested commit could not be checked out.",
      };
    }

    const files: Array<{ path: string; content: string }> = [];

    for (const file of input.files) {
      const path = safeRepoPath(file.path);
      if (!path) return { ok: false, reason: `${file.path} is not a repository path.` };

      if (file.mode === "write") {
        const bytes = Buffer.from(file.proposed, "utf8");

        await sandbox.upload(bytes, `${REBASE_DIR}/base/${path}`);
        await sandbox.upload(bytes, `${REBASE_DIR}/head/${path}`);

        files.push({ path, content: file.proposed });
        continue;
      }

      const anchor =
        file.original === null ? null : deriveReplacement(file.original, file.proposed);

      if (!anchor) {
        return { ok: false, reason: `${path} has no exact edit to re-apply.` };
      }

      const atBase = await readWorkspaceFile(sandbox, `${REBASE_DIR}/base/${path}`);
      if (atBase === null) {
        return { ok: false, reason: `${path} is not in the suggested commit.` };
      }

      const baseNext = replaceOnce(atBase, anchor.find, anchor.replace);
      if (baseNext === null) {
        return { ok: false, reason: `${path} no longer matches the suggestion.` };
      }

      // The reviewed edit, applied where it was proposed. This is the check that
      // makes a re-apply meaningful: if it does not hold here, it is not the
      // change the reader accepted.
      await sandbox.upload(
        Buffer.from(baseNext, "utf8"),
        `${REBASE_DIR}/base/${path}`
      );

      const atHead = await readWorkspaceFile(sandbox, `${REBASE_DIR}/head/${path}`);
      if (atHead === null) {
        return { ok: false, reason: `${path} is not in the current code.` };
      }

      const headNext = replaceOnce(atHead, anchor.find, anchor.replace);
      if (headNext === null) {
        return { ok: false, reason: `${path} changed since the suggestion.` };
      }

      await sandbox.upload(
        Buffer.from(headNext, "utf8"),
        `${REBASE_DIR}/head/${path}`
      );

      files.push({ path, content: headNext });
    }

    return { ok: true, files };
  } catch (caught) {
    return { ok: false, reason: messageOf(caught) };
  } finally {
    if (sandbox) await sandbox.destroy();
  }
}
