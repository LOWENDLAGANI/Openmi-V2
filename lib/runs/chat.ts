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
  tokens: number
): Promise<boolean> {
  if (!run.chat_id || text.trim().length === 0) return false;

  const { error } = await admin.rpc("append_worker_message", {
    p_owner: run.owner,
    p_chat_id: run.chat_id,
    p_role: "assistant",
    p_content: text.slice(0, 40_000),
    p_model: run.model,
    p_tokens: tokens,
    p_thinking: null,
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
export async function proposeChatChangeset(input: {
  admin: SupabaseClient;
  run: RunRow;
  sandbox: SandboxHandle;
  files: string[];
  token: string;
  sealKey: string | null;
}): Promise<string | null> {
  const { admin, run, sandbox, token, sealKey } = input;

  if (!run.chat_id || !run.repo_full_name || !run.base_sha) return null;

  const paths = input.files.slice(0, MAX_PROPOSED_FILES);
  if (paths.length === 0) return null;

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

  if (edits.length === 0) return null;

  const created = await createChangeset(admin as never, {
    owner: run.owner,
    chatId: run.chat_id,
    turnId: run.id,
    repo: run.repo_full_name,
    baseSha: run.base_sha,
  });

  if (!created.ok) return null;

  const added = await addEdits(admin as never, {
    changesetId: created.id,
    owner: run.owner,
    token,
    repo: run.repo_full_name,
    sha: run.base_sha,
    edits,
  });

  if (!added.ok) return null;

  const finalized = await finalizeChangeset(admin as never, {
    changesetId: created.id,
    baseSha: run.base_sha,
    sealKey,
  });

  return finalized.status === "ready" ? created.id : null;
}

export type ChatDelivery = {
  message: boolean;
  changeset: string | null;
};

export async function deliverChatTurn(input: {
  admin: SupabaseClient;
  run: RunRow;
  sandbox: SandboxHandle | null;
  text: string;
  files: string[];
  token: string | null;
  sealKey: string | null;
  tokens: number;
}): Promise<ChatDelivery> {
  const { run } = input;

  if (!run.chat_id) return { message: false, changeset: null };

  const message = await appendChatAnswer(
    input.admin,
    run,
    input.text,
    input.tokens
  ).catch(() => false);

  if (!input.sandbox || !input.token || input.files.length === 0) {
    return { message, changeset: null };
  }

  const changeset = await proposeChatChangeset({
    admin: input.admin,
    run,
    sandbox: input.sandbox,
    files: input.files,
    token: input.token,
    sealKey: input.sealKey,
  }).catch(() => null);

  return { message, changeset };
}
