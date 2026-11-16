import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EditRequest } from "@/lib/changesets";
import {
  addEdits,
  createChangeset,
  finalizeChangeset,
} from "@/lib/changesets/store";
import type { SandboxHandle } from "@/lib/execution/provider";

import { RUN_READ_MAX_BYTES } from "./limits";
import type { RunRow } from "./store";
import { RUN_WORKDIR } from "./tools";

/**
 * What a run owes the chat it came from.
 *
 * The chat is the product; the run is how a message is executed. Two writes
 * make that true when a run settles:
 *
 *   1. the answer, appended to `messages` so the transcript is the same on every
 *      device and a closed tab loses nothing;
 *   2. the diff, proposed as a changeset so the review card and its
 *      "open a pull request" button keep working.
 *
 * Both are best effort. A run that changed no files has nothing to review, and
 * a message that cannot be written is a failed decoration, not a failed run —
 * but it is logged, because a chat that silently loses an answer is worse than
 * one that says so.
 */

/** A changeset of whole-file writes, read back out of the finished workspace. */
const MAX_PROPOSED_FILES = 12;

/**
 * Appends the assistant message to the chat.
 *
 * `append_worker_message` is the service-role counterpart of `append_message`:
 * it takes the owner as an argument and keeps the chat row lock, so a worker
 * and a reader can never pick the same `seq`.
 */
export async function appendChatAnswer(
  admin: SupabaseClient,
  run: RunRow,
  text: string,
  tokens: number,
  thinking = ""
): Promise<boolean> {
  if (!run.chat_id || text.trim().length === 0) return false;

  const { error } = await admin.rpc("append_worker_message", {
    p_owner: run.owner,
    p_chat_id: run.chat_id,
    p_role: "assistant",
    p_content: text.slice(0, 40_000),
    p_model: run.model,
    p_tokens: tokens,
    p_thinking:
      thinking.trim().length > 0 ? thinking.slice(0, 40_000) : null,
    p_steps: [],
  });

  return !error;
}

/**
 * Turns the files a run changed into a reviewable changeset.
 *
 * The original content is read at the base commit by `addEdits` itself, so the
 * diff the reader reviews is against the pin the chat was started from — not
 * against whatever the sandbox happened to contain. Each proposal is a
 * whole-file write: the sandbox has the finished file, and reconstructing a
 * patch from two texts is the changeset layer's job, not the worker's.
 */
/**
 * The changeset a turn produced, or the sentence that says why there is none.
 *
 * A null changeset used to be the whole answer, and the reader was left with a
 * model that had said its destination was recorded and an app that had silently
 * done nothing. Every early return here names its cause instead.
 */
export type ChangesetProposal = { id: string | null; reason: string | null };

export async function proposeChatChangeset(input: {
  admin: SupabaseClient;
  run: RunRow;
  sandbox: SandboxHandle;
  files: string[];
  token: string;
  sealKey: string | null;
}): Promise<ChangesetProposal> {
  const { admin, run, sandbox, token, sealKey } = input;

  if (!run.chat_id || !run.repo_full_name || !run.base_sha) {
    return {
      id: null,
      reason: "this chat has no repository at a pinned commit",
    };
  }

  const paths = input.files.slice(0, MAX_PROPOSED_FILES);
  if (paths.length === 0) {
    return {
      id: null,
      reason: "this turn changed no files in the workspace",
    };
  }

  const edits: EditRequest[] = [];

  for (const path of paths) {
    try {
      const content = await sandbox.readText(
        `${RUN_WORKDIR}/${path}`,
        RUN_READ_MAX_BYTES
      );

      if (content.length > 0) {
        edits.push({ path, mode: "write", content });
      }
    } catch {
      // A deleted or binary file has no whole-file write to propose. The run's
      // artifact list still records that it changed.
    }
  }

  if (edits.length === 0) {
    return {
      id: null,
      reason: "the changed files could not be read back from the workspace",
    };
  }

  const created = await createChangeset(admin as never, {
    owner: run.owner,
    chatId: run.chat_id,
    turnId: run.id,
    repo: run.repo_full_name,
    baseSha: run.base_sha,
  });

  if (!created.ok) return { id: null, reason: created.error };

  const added = await addEdits(admin as never, {
    changesetId: created.id,
    owner: run.owner,
    token,
    repo: run.repo_full_name,
    sha: run.base_sha,
    edits,
  });

  if (!added.ok) return { id: null, reason: added.error };

  const finalized = await finalizeChangeset(admin as never, {
    changesetId: created.id,
    baseSha: run.base_sha,
    sealKey,
  });

  if (finalized.status !== "ready") {
    return {
      id: null,
      reason: sealKey
        ? `the diff was recorded but could not be marked ready (${finalized.status})`
        : "GITHUB_TOKEN_KEY is not set on the worker, so the diff cannot be signed",
    };
  }

  return { id: created.id, reason: null };
}

export type ChatDelivery = {
  message: boolean;
  changeset: string | null;
  /** Why there is no changeset, when one was expected. Null when there is one. */
  reason: string | null;
};

export async function deliverChatTurn(input: {
  admin: SupabaseClient;
  run: RunRow;
  sandbox: SandboxHandle | null;
  text: string;
  thinking?: string;
  files: string[];
  token: string | null;
  sealKey: string | null;
  tokens: number;
}): Promise<ChatDelivery> {
  const { run } = input;

  if (!run.chat_id) return { message: false, changeset: null, reason: null };

  const message = await appendChatAnswer(
    input.admin,
    run,
    input.text,
    input.tokens,
    input.thinking ?? ""
  ).catch(() => false);

  if (!input.sandbox) {
    return {
      message,
      changeset: null,
      reason: "this turn had no workspace to diff",
    };
  }

  if (!input.token) {
    return {
      message,
      changeset: null,
      reason: "the worker had no GitHub token for this account",
    };
  }

  if (input.files.length === 0) {
    return {
      message,
      changeset: null,
      reason: "this turn changed no files in the workspace",
    };
  }

  const proposed = await proposeChatChangeset({
    admin: input.admin,
    run,
    sandbox: input.sandbox,
    files: input.files,
    token: input.token,
    sealKey: input.sealKey,
  }).catch((caught: unknown) => ({
    id: null,
    reason:
      caught instanceof Error
        ? caught.message
        : "the diff could not be recorded",
  }));

  return { message, changeset: proposed.id, reason: proposed.reason };
}
