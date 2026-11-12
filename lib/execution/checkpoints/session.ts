import "server-only";

import { shellQuote } from "@/lib/agent/shell";
import { isLeaseLive } from "@/lib/execution/chat-env/lifecycle";
import {
  readChatSandbox,
  type ChatSandboxRow,
} from "@/lib/execution/chat-env/store";
import { MISSION_WORKDIR } from "@/lib/execution/mission/budget";
import {
  SandboxStartError,
  attachSandbox,
  type SandboxHandle,
} from "@/lib/execution/provider";
import { supabaseAdmin } from "@/lib/supabase/admin";

import {
  changedFileCount,
  defaultCheckpointLabel,
  isCheckpointSha,
  shaFromOutput,
} from "./plan";
import { insertCheckpoint, type CheckpointRow } from "./store";

/**
 * Committing and restoring versions inside a chat's workspace.
 *
 * A version is a plain git commit on the `openmi/work/<chat>` branch the seed
 * created. It is made by this server, in the box, and it is never pushed: the
 * sandbox has no remote and no credential, so "restore" can only move backwards
 * through work the chat itself produced.
 *
 * Both operations refuse while a turn holds the lease. Restoring underneath a
 * running turn would reset files the turn is editing, and the turn would then
 * report success over a tree that no longer matches.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

const REPO_DIR = MISSION_WORKDIR;

const NO_WORKSPACE =
  "This chat has no workspace yet. Send a message that needs the sandbox first.";

const BUSY =
  "A turn is running in this chat. Versions can be saved or restored when it finishes.";

export type CheckpointFailure =
  | "no_workspace"
  | "busy"
  | "provider"
  | "git_failed"
  | "unknown_version";

export type CheckpointResult =
  | { ok: true; created: boolean; checkpoint?: CheckpointRow }
  | { ok: false; failure: CheckpointFailure; message: string };

export type RestoreResult =
  | { ok: true; head: string }
  | { ok: false; failure: CheckpointFailure; message: string };

function messageOf(caught: unknown): string {
  if (caught instanceof SandboxStartError) return caught.message;
  return caught instanceof Error && caught.message.length > 0
    ? caught.message
    : "The sandbox could not be reached.";
}

/** The chat's box, awake, with the lease checked first. */
async function openForCheckpoint(input: {
  admin: Admin;
  chatId: string;
  owner: string;
}): Promise<
  | { ok: true; row: ChatSandboxRow; handle: SandboxHandle }
  | { ok: false; failure: CheckpointFailure; message: string }
> {
  const row = await readChatSandbox(input.admin, input.chatId);

  if (!row || row.owner !== input.owner) {
    return { ok: false, failure: "no_workspace", message: NO_WORKSPACE };
  }

  if (isLeaseLive(row.leaseUntil)) {
    return { ok: false, failure: "busy", message: BUSY };
  }

  if (row.state === "provisioning" || row.state === "wiping") {
    return {
      ok: false,
      failure: "no_workspace",
      message: "This chat's workspace is being prepared. Try again in a moment.",
    };
  }

  try {
    const handle = await attachSandbox(row.sandboxId);
    await handle.start(90);
    return { ok: true, row, handle };
  } catch (caught) {
    return { ok: false, failure: "provider", message: messageOf(caught) };
  }
}

/**
 * Commits whatever the workspace holds, and records it.
 *
 * A clean tree produces no checkpoint rather than an empty commit: the list is
 * supposed to be a history of changes, and a turn that only read files did not
 * make one.
 */
export async function recordCheckpoint(input: {
  admin: Admin;
  chatId: string;
  owner: string;
  sandboxId: string;
  handle: SandboxHandle;
  label?: string;
  turnId?: string | null;
  source?: "turn" | "manual";
}): Promise<CheckpointResult> {
  const status = await input.handle.exec(
    "git status --porcelain",
    REPO_DIR,
    20_000
  );

  if (status.exitCode !== 0) {
    return {
      ok: false,
      failure: "git_failed",
      message: status.output.trim() || "The workspace is not a git repository.",
    };
  }

  const files = changedFileCount(status.output);

  if (files === 0) return { ok: true, created: false };

  const label = (input.label?.trim() || defaultCheckpointLabel()).slice(0, 80);

  const committed = await input.handle.exec(
    [
      "git add -A",
      `git -c commit.gpgsign=false commit -qm ${shellQuote(label)}`,
      "git rev-parse HEAD",
    ].join(" && "),
    REPO_DIR,
    30_000
  );

  if (committed.exitCode !== 0) {
    return {
      ok: false,
      failure: "git_failed",
      message: committed.output.trim() || "The version could not be committed.",
    };
  }

  const sha = shaFromOutput(committed.output);

  if (!sha) {
    return {
      ok: false,
      failure: "git_failed",
      message: "The commit was made but its sha could not be read.",
    };
  }

  const checkpoint = await insertCheckpoint(input.admin, {
    chatId: input.chatId,
    owner: input.owner,
    sandboxId: input.sandboxId,
    commitSha: sha,
    label,
    turnId: input.turnId ?? null,
    filesChanged: files,
    source: input.source ?? "turn",
  });

  return { ok: true, created: true, checkpoint: checkpoint ?? undefined };
}

export async function saveCheckpoint(input: {
  admin: Admin;
  chatId: string;
  owner: string;
  label?: string;
}): Promise<CheckpointResult> {
  const opened = await openForCheckpoint(input);
  if (!opened.ok) return opened;

  return recordCheckpoint({
    admin: input.admin,
    chatId: input.chatId,
    owner: input.owner,
    sandboxId: opened.row.sandboxId,
    handle: opened.handle,
    label: input.label,
    source: "manual",
  });
}

/**
 * Moves the workspace back to a recorded commit.
 *
 * `git reset --hard` plus `git clean -fd` is deliberate: a restore that left
 * untracked files behind would keep exactly the work the reader asked to undo.
 * Build and dependency directories are the exception, because they are not the
 * reader's work and reinstalling them is a minute of their time. The head is
 * read back afterwards so the caller reports what git did rather than what was
 * requested.
 */
export async function restoreCheckpoint(input: {
  admin: Admin;
  chatId: string;
  owner: string;
  sha: string;
}): Promise<RestoreResult> {
  if (!isCheckpointSha(input.sha)) {
    return {
      ok: false,
      failure: "unknown_version",
      message: "That version is not a commit sha.",
    };
  }

  const opened = await openForCheckpoint(input);
  if (!opened.ok) return opened;

  const exists = await opened.handle.exec(
    `git cat-file -e ${input.sha}^{commit}`,
    REPO_DIR,
    20_000
  );

  if (exists.exitCode !== 0) {
    return {
      ok: false,
      failure: "unknown_version",
      message: "That version is not in this workspace any more.",
    };
  }

  // `clean` without `-x` already leaves ignored paths alone, but a seeded
  // workspace has no .gitignore for the directories an install creates, so they
  // are excluded by name: restoring a version should not throw away the
  // dependencies the workspace needs to run again.
  const reset = await opened.handle.exec(
    `git reset --hard ${input.sha} && git clean -fd -e node_modules -e .next -e dist -e build -e coverage`,
    REPO_DIR,
    60_000
  );

  if (reset.exitCode !== 0) {
    return {
      ok: false,
      failure: "git_failed",
      message: reset.output.trim() || "The workspace could not be restored.",
    };
  }

  const head = await opened.handle.exec("git rev-parse HEAD", REPO_DIR, 20_000);
  const value = shaFromOutput(head.output);

  if (!value) {
    return {
      ok: false,
      failure: "git_failed",
      message: "The workspace was restored but its head could not be read.",
    };
  }

  return { ok: true, head: value };
}

