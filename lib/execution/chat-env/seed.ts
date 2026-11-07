import "server-only";

import { workBranchName } from "@/lib/branch";
import { fetchRepoArchive } from "@/lib/execution/archive";
import { MISSION_WORKDIR } from "@/lib/execution/mission/budget";
import type { SandboxHandle } from "@/lib/execution/provider";

/**
 * Puts a repository into a chat's box, once.
 *
 * The same shape a verification run uses — one tarball at the pinned commit,
 * no remote, no credential, a single `base` commit on a `openmi/work/` branch —
 * with one addition: a marker outside the workspace. The database records that a
 * row is seeded; the marker lets a resume ask the disk whether it agrees. A box
 * whose marker is gone is reseeded rather than trusted.
 */

export type SeedFailure = "repo_too_large" | "seed_failed";

export type SeedResult =
  | { ok: true }
  | { ok: false; failure: SeedFailure; detail: string };

const MARKER_PATH = ".openmi/env.json";

export async function seedChatWorkspace(input: {
  sandbox: SandboxHandle;
  token: string;
  repo: string;
  sha: string;
  chatId: string;
}): Promise<SeedResult> {
  const archive = await fetchRepoArchive({
    token: input.token,
    repo: input.repo,
    sha: input.sha,
  });

  if (!archive.ok) return archive;

  const made = await input.sandbox.exec(
    `mkdir -p ${MISSION_WORKDIR} .openmi`,
    ".",
    60_000
  );

  if (made.exitCode !== 0) {
    return {
      ok: false,
      failure: "seed_failed",
      detail: made.output.length > 0 ? made.output : "The workspace could not be created.",
    };
  }

  try {
    await input.sandbox.upload(archive.bytes, `${MISSION_WORKDIR}/src.tgz`);
  } catch (caught) {
    return {
      ok: false,
      failure: "seed_failed",
      detail: caught instanceof Error ? caught.message : "The archive could not be uploaded.",
    };
  }

  const branch = workBranchName(input.chatId);

  const extracted = await input.sandbox.exec(
    [
      "tar xzf src.tgz",
      "rm -f src.tgz",
      "rm -rf node_modules .next dist build vendor target .git",
      "find . -maxdepth 2 -name '.env*' -delete",
      "git init -q .",
      "git config user.name Openmi",
      "git config user.email openmi@users.noreply.github.com",
      "git add -A",
      "git -c commit.gpgsign=false commit -qm base",
      // The copy is a clone on its own branch, so an edit here is a change on a
      // branch rather than a change on a detached copy of the default branch.
      `git branch -m ${branch}`,
    ].join(" && "),
    MISSION_WORKDIR,
    120_000
  );

  if (extracted.exitCode !== 0) {
    return {
      ok: false,
      failure: "seed_failed",
      detail: `The archive could not be extracted: ${extracted.output}`,
    };
  }

  const marker = Buffer.from(
    JSON.stringify({
      chatId: input.chatId,
      repo: input.repo,
      sha: input.sha,
      branch,
      seededAt: new Date().toISOString(),
    }),
    "utf8"
  );

  try {
    await input.sandbox.upload(marker, MARKER_PATH);
  } catch (caught) {
    return {
      ok: false,
      failure: "seed_failed",
      detail:
        caught instanceof Error
          ? caught.message
          : "The workspace marker could not be written.",
    };
  }

  return { ok: true };
}

/**
 * The disk's own claim that it holds this chat's workspace.
 *
 * `test` rather than a read: two existence checks cost one command and cannot
 * be fooled by a half-written marker.
 */
export async function chatWorkspaceIntact(sandbox: SandboxHandle): Promise<boolean> {
  const check = await sandbox.exec(
    `test -d ${MISSION_WORKDIR}/.git && test -f ${MARKER_PATH}`,
    ".",
    30_000
  );

  return check.exitCode === 0;
}

/**
 * Re-applies the seed's `.env*` rule on every resume.
 *
 * A previous message's `write_file` could have created one, and a persistent
 * disk is exactly where that would survive unnoticed.
 */
export async function scrubChatWorkspace(sandbox: SandboxHandle): Promise<void> {
  try {
    await sandbox.exec(
      `find ${MISSION_WORKDIR} -maxdepth 3 -name '.env*' -delete`,
      ".",
      30_000
    );
  } catch {
    // A failed scrub is not a reason to refuse a workspace the user can see.
  }
}
