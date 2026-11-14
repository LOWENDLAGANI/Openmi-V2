import { fetchRepoArchive } from "@/lib/execution/archive";
import {
  createRunSandbox as createProviderSandbox,
  type SandboxHandle,
} from "@/lib/execution/provider";

import { RUN_SANDBOX_TTL_MINUTES } from "./limits";
import { RUN_WORKDIR } from "./tools";

/**
 * The workspace one run gets.
 *
 * The plan asks for `/work`. E2B runs commands and writes files as its `user`,
 * whose only writable root is `/home/user`, so the workspace is
 * `/home/user/work` — the provider's home decides the path, and the tool layer
 * only ever sees paths relative to that root. The plan's intent (one ephemeral
 * directory per run, with a fixed name) is kept; the absolute path is not.
 *
 * The sandbox is created from a fixed template, is non-root, has no docker
 * socket and no credential, and is killed in the caller's `finally`.
 */

export { RUN_WORKDIR };

export type OpenWorkspaceResult =
  | { ok: true; sandbox: SandboxHandle; seeded: boolean; notice: string | null }
  | { ok: false; message: string };

export async function openRunWorkspace(input: {
  runId: string;
  repo: string | null;
  sha: string | null;
  token: string | null;
}): Promise<OpenWorkspaceResult> {
  let sandbox: SandboxHandle;

  try {
    sandbox = await createProviderSandbox(input.runId, RUN_SANDBOX_TTL_MINUTES);
  } catch (caught) {
    return {
      ok: false,
      message:
        caught instanceof Error
          ? `The sandbox could not be started: ${caught.message}`
          : "The sandbox could not be started.",
    };
  }

  await input.runId; // the id is already recorded on the box's metadata

  const made = await sandbox.exec(`mkdir -p ${RUN_WORKDIR}`, ".", 60_000);

  if (made.exitCode !== 0) {
    await sandbox.destroy();
    return {
      ok: false,
      message: `The workspace directory could not be created: ${made.output}`,
    };
  }

  // No repository: the run still gets a workspace, seeded with an empty git
  // checkout so `git diff` works and a new project can be built from nothing.
  if (!input.repo || !input.sha || !input.token) {
    const initialised = await seedEmptyWorkspace(sandbox);

    return initialised.ok
      ? { ok: true, sandbox, seeded: false, notice: null }
      : { ok: false, message: initialised.detail };
  }

  const seeded = await seedRunWorkspace({
    sandbox,
    token: input.token,
    repo: input.repo,
    sha: input.sha,
  });

  if (!seeded.ok) {
    await sandbox.destroy();
    return { ok: false, message: seeded.detail };
  }

  return { ok: true, sandbox, seeded: true, notice: null };
}

async function seedEmptyWorkspace(
  sandbox: SandboxHandle
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const result = await sandbox.exec(
    [
      "git init -q .",
      "git config user.name Openmi",
      "git config user.email openmi@users.noreply.github.com",
      "printf '' > .gitkeep",
      "git add -A",
      "git -c commit.gpgsign=false commit -qm base",
    ].join(" && "),
    RUN_WORKDIR,
    60_000
  );

  return result.exitCode === 0
    ? { ok: true }
    : { ok: false, detail: `The empty workspace could not be prepared: ${result.output}` };
}

/**
 * Puts an immutable copy of the repository at the pinned commit into the box.
 *
 * The same shape a verification run uses: one tarball, one `base` commit, a
 * real `origin` with no credential and `push.default nothing`. A command in the
 * sandbox can therefore read history and diff, and cannot authenticate to
 * GitHub even if a prompt injection tells it to.
 */
export async function seedRunWorkspace(input: {
  sandbox: SandboxHandle;
  token: string;
  repo: string;
  sha: string;
}): Promise<{ ok: true } | { ok: false; detail: string }> {
  const archive = await fetchRepoArchive({
    token: input.token,
    repo: input.repo,
    sha: input.sha,
  });

  if (!archive.ok) {
    return {
      ok: false,
      detail:
        "detail" in archive && typeof archive.detail === "string"
          ? archive.detail
          : "The repository could not be read.",
    };
  }

  try {
    await input.sandbox.upload(archive.bytes, `${RUN_WORKDIR}/src.tgz`);
  } catch (caught) {
    return {
      ok: false,
      detail:
        caught instanceof Error ? caught.message : "The archive could not be uploaded.",
    };
  }

  const origin = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(input.repo)
    ? `https://github.com/${input.repo}.git`
    : null;

  const extracted = await input.sandbox.exec(
    [
      "tar xzf src.tgz",
      "rm -f src.tgz",
      "rm -rf node_modules .next dist build out vendor target .git",
      "find . -maxdepth 2 -name '.env*' -delete",
      "git init -q .",
      "git config user.name Openmi",
      "git config user.email openmi@users.noreply.github.com",
      "git add -A",
      "git -c commit.gpgsign=false commit -qm base",
      ...(origin
        ? [
            `git remote add origin ${origin}`,
            "git config --local push.default nothing",
            'git config --local credential.helper ""',
            'git config --local core.askPass ""',
          ]
        : []),
    ].join(" && "),
    RUN_WORKDIR,
    180_000
  );

  if (extracted.exitCode !== 0) {
    return {
      ok: false,
      detail: `The archive could not be extracted: ${extracted.output}`,
    };
  }

  return { ok: true };
}

/**
 * Teardown, in a `finally`.
 *
 * A failed kill is not a failed run: the provider's own `onTimeout: kill` is
 * the backstop, and the orphan sweep destroys anything a row no longer points
 * at. Returning rather than throwing here is deliberate.
 */
export async function closeRunWorkspace(sandbox: SandboxHandle): Promise<void> {
  try {
    await sandbox.destroy();
  } catch {
    // Backstop: the sandbox TTL.
  }
}
