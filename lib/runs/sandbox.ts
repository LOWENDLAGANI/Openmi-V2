import { fetchRepoArchive } from "@/lib/execution/archive";
import { chatSandboxesEnabled } from "@/lib/execution/chat-env/lifecycle";
import {
  openChatSandbox,
  releaseChatSandbox,
} from "@/lib/execution/chat-env/open";
import { MISSION_WORKDIR } from "@/lib/execution/mission/budget";
import {
  attachSandbox,
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
  | {
      ok: true;
      sandbox: SandboxHandle;
      seeded: boolean;
      notice: string | null;
      /** True when the box is the chat's own workspace, owned by its row. */
      shared: boolean;
      /**
       * How this run gives the workspace back. A chat's box is released (the
       * next message must find it); a run's own box is paused.
       */
      release: () => Promise<void>;
    }
  | { ok: false; message: string };

type ChatAdmin = Parameters<typeof openChatSandbox>[0]["admin"];

export type OpenWorkspaceInput = {
  runId: string;
  repo: string | null;
  sha: string | null;
  token: string | null;
  /** The chat this run answers, when it answers one. */
  chatId?: string | null;
  owner?: string | null;
  /** Needed for the chat's workspace row; absent means a run box. */
  admin?: ChatAdmin | null;
  /** The box a previous attempt recorded, when this run is a retry. */
  sandboxId?: string | null;
  /** The E2B account that can open `sandboxId`. */
  sandboxAccount?: string | null;
};

/**
 * The workspace a run works in.
 *
 * A chat turn reuses the workspace that chat already owns, so a message after
 * it finds the same disk: installed packages, built output and uncommitted
 * files are still there, and the turn does not pay for a cold box and a fresh
 * seed every time. That box belongs to the chat (`chat_sandboxes`), so it is
 * released, never paused or destroyed here.
 *
 * A run with no chat — or one whose chat workspace cannot be opened — falls back
 * to a box of its own, which is what every run used to get.
 */
export async function openRunWorkspace(
  input: OpenWorkspaceInput
): Promise<OpenWorkspaceResult> {
  const chat = await openChatWorkspace(input);
  if (chat) return chat;

  // A retry picks up the disk its first attempt was using. Creating a second box
  // is what made a resumed run start from the seeded commit, with every edit the
  // first attempt made thrown away.
  const resumed = await resumeRecordedWorkspace(input);
  if (resumed) return resumed;

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
      ? {
          ok: true,
          sandbox,
          seeded: false,
          notice: null,
          shared: false,
          release: () => pauseRunWorkspace(sandbox),
        }
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

  return {
    ok: true,
    sandbox,
    seeded: true,
    notice: null,
    shared: false,
    release: () => pauseRunWorkspace(sandbox),
  };
}

/**
 * The box this run already had, reattached.
 *
 * A run's workspace is paused when it settles and kept for its TTL, so a run
 * handed back to the queue after its worker vanished can pick up the same disk:
 * the edits it made, the packages it installed, the branch it started.
 *
 * Null means "not resumable" — no recorded box, a box the provider no longer
 * has, or one whose workspace directory is gone — and the caller makes a fresh
 * box instead. A box that cannot be used is destroyed rather than left to bill.
 */
async function resumeRecordedWorkspace(
  input: OpenWorkspaceInput
): Promise<OpenWorkspaceResult | null> {
  if (!input.sandboxId || !input.sandboxAccount) return null;

  let sandbox: SandboxHandle;

  try {
    sandbox = await attachSandbox(input.sandboxId, input.sandboxAccount);
  } catch {
    // Gone or unreadable: the run starts again on a new box, which is the only
    // other way it can start at all.
    return null;
  }

  const probe = await sandbox
    .exec(`cd ${RUN_WORKDIR} && git status --porcelain | head -n 1`, ".", 30_000)
    .catch(() => null);

  if (!probe || probe.exitCode !== 0) {
    await sandbox.destroy().catch(() => {});
    return null;
  }

  return {
    ok: true,
    sandbox,
    seeded: true,
    notice: "resumed this run's existing workspace",
    shared: false,
    release: () => pauseRunWorkspace(sandbox),
  };
}

/**
 * The chat's own workspace, when this run answers one.
 *
 * Null means "not this path": no chat, no repository to seed, the chat env
 * switched off, or no admin client to read the row. A refusal from the resolver
 * is an error with its own sentence, because a chat that cannot open its
 * workspace should say so rather than silently start a second one.
 */
async function openChatWorkspace(
  input: OpenWorkspaceInput
): Promise<OpenWorkspaceResult | null> {
  if (!chatSandboxesEnabled()) return null;
  if (!input.admin || !input.chatId || !input.owner) return null;
  if (!input.repo || !input.sha || !input.token) return null;

  const admin = input.admin;

  const opened = await openChatSandbox({
    admin,
    chatId: input.chatId,
    owner: input.owner,
    repo: input.repo,
    sha: input.sha,
    token: input.token,
  });

  if (!opened.ok) {
    return {
      ok: false,
      message: `This chat's workspace could not be opened: ${opened.message}`,
    };
  }

  // The run tools work in `work`; a chat's workspace is `openmi-workspace`. One
  // relative link makes both names the same disk, so no tool needs a second
  // root and no file is copied.
  const linked = await linkRunWorkdir(opened.handle);

  if (!linked.ok) {
    await releaseChatSandbox({
      admin,
      rowId: opened.row.id,
      handle: opened.handle,
    }).catch(() => {});

    return { ok: false, message: linked.message };
  }

  // Start the turn from a committed workspace, so the diff this run publishes is
  // its own work: earlier messages may have left uncommitted files behind, and
  // they are not this turn's change.
  await markTurnBase(opened.handle, input.runId).catch(() => {});

  return {
    ok: true,
    sandbox: opened.handle,
    seeded: opened.recreated,
    notice: opened.notice ?? null,
    shared: true,
    release: async () => {
      await releaseChatSandbox({
        admin,
        rowId: opened.row.id,
        handle: opened.handle,
      });
    },
  };
}

/** Points the run's own workspace path at the chat's directory. */
async function linkRunWorkdir(
  sandbox: SandboxHandle
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await sandbox.exec(
    [
      `if [ ! -e ${RUN_WORKDIR} ]; then ln -s ${MISSION_WORKDIR} ${RUN_WORKDIR}; fi`,
      `test -d ${RUN_WORKDIR}/.git`,
    ].join(" && "),
    ".",
    30_000
  );

  return result.exitCode === 0
    ? { ok: true }
    : {
        ok: false,
        message: `The chat's workspace could not be reached: ${
          result.output.trim() || "no reason reported"
        }`,
      };
}

/**
 * Commits whatever the previous turn left behind, so this turn's diff is its own.
 *
 * Local only: a commit inside the workspace is not a push, and the write to
 * GitHub still goes through the changeset path.
 */
async function markTurnBase(
  sandbox: SandboxHandle,
  runId: string
): Promise<void> {
  await sandbox.exec(
    [
      "git add -A >/dev/null 2>&1",
      `if ! git diff --cached --quiet; then git -c commit.gpgsign=false commit -qm "openmi: workspace before run ${runId}"; fi`,
    ].join("; "),
    RUN_WORKDIR,
    60_000
  );
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
      // GitHub's tarball wraps everything in `owner-repo-sha/`. Stripping it is
      // what makes a path in the workspace the path in the repository: without
      // this, every diff was `owner-repo-sha/README.md` and the changeset wrote
      // a nested copy instead of editing the file.
      `tar xzf src.tgz --strip-components=1`,
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
