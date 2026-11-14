import { fetchRepoArchive } from "@/lib/execution/archive";
import {
  createRunSandbox as createProviderSandbox,
  type SandboxHandle,
} from "@/lib/execution/provider";

import { RUN_WORKDIR } from "./tools";

/**
 * The workspace one run gets.
 *
 * The plan asks for `/work`. E2B runs commands and writes files as its `user`,
 * whose only writable root is `/home/user`, so the workspace is
 * `/home/user/work` — the provider's home decides the path, and the tool layer
 * only ever sees paths relative to that root. The plan's intent (one directory
 * per run, with a fixed name) is kept; the absolute path is not.
 *
 * The sandbox is created from a fixed template, is non-root and has no docker
 * socket or credential. It is **paused**, not killed, when the run settles:
 * compute is released, the disk is kept for `RUN_SANDBOX_TTL_HOURS` (48), and
 * the sweep destroys it after that.
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
    sandbox = await createProviderSandbox(input.runId);
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
 * Teardown, in a `finally`: pause, never destroy.
 *
 * The disk is the only copy of what the run installed and wrote, and the
 * 48-hour retention is a promise the UI and the sweep both make. Pausing
 * releases compute immediately, so a run costs memory for minutes and disk for
 * two days, not a box running overnight.
 *
 * A refused pause is not a failed run: the provider's own `onTimeout: pause`
 * does the same job at the deadline, and the sweep removes the box when the
 * window closes. Returning rather than throwing is deliberate.
 */
export async function pauseRunWorkspace(sandbox: SandboxHandle): Promise<void> {
  try {
    await sandbox.stop();
  } catch {
    // Backstop: the provider pauses at the deadline, and the sweep still owns
    // the destruction clock.
  }
}
