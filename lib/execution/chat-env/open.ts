import "server-only";

import { executionConfigured } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";

import {
  SandboxStartError,
  attachSandbox,
  createChatSandbox,
  type SandboxHandle,
} from "@/lib/execution/provider";

import {
  chatSandboxArchiveHours,
  chatSandboxIdleMinutes,
  chatSandboxMaxPerOwner,
  chatSandboxTtlHours,
  chatSandboxTtlMinutes,
  decideChatSandboxOpen,
  deleteAfter,
  evictionsForNew,
  leaseUntil,
  type ChatSandboxOpenDecision,
} from "./lifecycle";
import { chatWorkspaceIntact, scrubChatWorkspace, seedChatWorkspace } from "./seed";
import {
  claimChatSandbox,
  deleteChatSandboxRow,
  insertChatSandbox,
  listOwnerChatSandboxes,
  markChatSandboxFailed,
  readChatSandbox,
  releaseChatSandboxRow,
  updateChatSandbox,
  type ChatSandboxRow,
} from "./store";

/**
 * Opens the one workspace a chat owns.
 *
 * The order is the contract: decide on the pure facts, claim the lease, then
 * touch the provider. A row is written immediately after the box is created
 * and before it is seeded, because the alternative is a container nobody can
 * find if this process dies mid-seed.
 *
 * `notice` is for the reader, not the model: waking a stopped or archived box
 * takes a few seconds and should not look like a stalled turn.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

export type ChatSandboxFailure =
  | "not_configured"
  | "quota"
  | "refused"
  | "missing"
  | "repo_too_large"
  | "seed_failed";

export type OpenChatSandboxResult =
  | {
      ok: true;
      handle: SandboxHandle;
      row: ChatSandboxRow;
      /** True when a stopped/archived box was started. */
      resumed: boolean;
      /** True when the workspace was created or seeded in this call. */
      recreated: boolean;
      notice?: string;
    }
  | { ok: false; failure: ChatSandboxFailure; message: string };

type OpenInput = {
  admin: Admin;
  chatId: string;
  owner: string;
  repo: string;
  sha: string;
  token: string;
  now?: number;
  leaseMs?: number;
};

const WAIT_MESSAGE =
  "This chat's workspace is being prepared in another tab. Try again in a moment.";

function messageOf(caught: unknown): string {
  return caught instanceof Error && caught.message.length > 0
    ? caught.message
    : "The sandbox could not be started.";
}

function failureOf(caught: unknown): ChatSandboxFailure {
  return caught instanceof SandboxStartError ? caught.failure : "refused";
}

async function safeDestroy(handle: SandboxHandle): Promise<void> {
  try {
    await handle.destroy();
  } catch {
    // A failed destroy is left to the TTL and the label reconciliation pass;
    // it must not turn a seed failure into a different failure.
  }
}

async function refreshTtl(handle: SandboxHandle): Promise<void> {
  try {
    await handle.setTtl(chatSandboxTtlMinutes());
  } catch {
    // The create-time TTL and auto-delete are the backstops. A refresh that
    // fails means the deadline is older than it should be, not that the box is
    // unusable.
  }
}

/**
 * Destroys a row's box and forgets it.
 *
 * Used for a pin change, an orphan, and an explicit reseed. If the provider
 * delete fails, the row still goes: `chat_id` is unique, so keeping it would
 * prevent the replacement from being recorded. The label reconciliation pass is
 * what catches the container in that case.
 */
async function retireRow(admin: Admin, row: ChatSandboxRow): Promise<void> {
  await updateChatSandbox(admin, row.id, {
    state: "wiping",
    lease_until: null,
    delete_after: new Date().toISOString(),
  });

  try {
    const handle = await attachSandbox(row.sandboxId);
    await handle.destroy();
  } catch {
    // Missing or already deleted is the desired outcome.
  }

  await deleteChatSandboxRow(admin, row.id);
}

async function evictForCap(input: OpenInput): Promise<void> {
  const rows = await listOwnerChatSandboxes(input.admin, input.owner);
  const evictions = evictionsForNew(
    rows,
    chatSandboxMaxPerOwner(),
    input.chatId
  );

  for (const row of evictions) {
    await retireRow(input.admin, row);
  }
}

async function provision(
  input: OpenInput,
  lease: string
): Promise<OpenChatSandboxResult> {
  await evictForCap(input);

  let handle: SandboxHandle;
  try {
    handle = await createChatSandbox({
      chatId: input.chatId,
      owner: input.owner,
      ttlMinutes: chatSandboxTtlMinutes(),
      autoDeleteMinutes: chatSandboxTtlHours() * 60,
      idleMinutes: chatSandboxIdleMinutes(),
      archiveMinutes: chatSandboxArchiveHours() * 60,
    });
  } catch (caught) {
    return {
      ok: false,
      failure: failureOf(caught),
      message: messageOf(caught),
    };
  }

  let row: ChatSandboxRow;
  try {
    row = await insertChatSandbox(input.admin, {
      chatId: input.chatId,
      owner: input.owner,
      sandboxId: handle.id,
      repoFullName: input.repo,
      baseSha: input.sha,
      leaseUntil: lease,
      deleteAfter: deleteAfter(Date.now(), chatSandboxTtlHours()),
    });
  } catch (caught) {
    await safeDestroy(handle);
    return { ok: false, failure: "refused", message: messageOf(caught) };
  }

  const seeded = await seedChatWorkspace({
    sandbox: handle,
    token: input.token,
    repo: input.repo,
    sha: input.sha,
    chatId: input.chatId,
  });

  if (!seeded.ok) {
    await safeDestroy(handle);
    await deleteChatSandboxRow(input.admin, row.id);

    return { ok: false, failure: seeded.failure, message: seeded.detail };
  }

  const finishedAt = Date.now();
  const lastActiveAt = new Date(finishedAt).toISOString();

  await updateChatSandbox(input.admin, row.id, {
    state: "running",
    workspace_seeded_at: lastActiveAt,
    last_active_at: lastActiveAt,
    delete_after: deleteAfter(finishedAt, chatSandboxTtlHours()),
    lease_until: lease,
    failure_code: null,
    failure_detail: null,
  });

  await refreshTtl(handle);

  return {
    ok: true,
    handle,
    row: {
      ...row,
      state: "running",
      workspaceSeededAt: lastActiveAt,
      lastActiveAt,
      leaseUntil: lease,
    },
    resumed: false,
    recreated: true,
  };
}

async function resume(
  input: OpenInput,
  row: ChatSandboxRow,
  lease: string,
  start: boolean
): Promise<OpenChatSandboxResult> {
  const claimed = await claimChatSandbox(input.admin, {
    id: row.id,
    now: input.now ?? Date.now(),
    leaseUntil: lease,
  });

  if (!claimed) {
    return { ok: false, failure: "refused", message: WAIT_MESSAGE };
  }

  let handle: SandboxHandle;
  try {
    handle = await attachSandbox(claimed.sandboxId);
  } catch (caught) {
    const failure = failureOf(caught);
    await markChatSandboxFailed(input.admin, row.id, {
      code: failure,
      detail: messageOf(caught),
    });

    return { ok: false, failure, message: messageOf(caught) };
  }

  if (start) {
    try {
      await handle.start(90);
    } catch (caught) {
      const failure = failureOf(caught);

      if (failure === "missing") {
        await safeDestroy(handle);
      }

      await markChatSandboxFailed(input.admin, row.id, {
        code: failure,
        detail: messageOf(caught),
      });

      return { ok: false, failure, message: messageOf(caught) };
    }
  }

  if (!(await chatWorkspaceIntact(handle))) {
    // A box that cannot prove it holds this chat's workspace is not reused.
    await safeDestroy(handle);
    await deleteChatSandboxRow(input.admin, row.id);

    return {
      ok: false,
      failure: "missing",
      message: "The workspace was gone, so it has to be recreated.",
    };
  }

  await scrubChatWorkspace(handle);

  const now = Date.now();
  const lastActiveAt = new Date(now).toISOString();

  await updateChatSandbox(input.admin, row.id, {
    state: "running",
    last_active_at: lastActiveAt,
    delete_after: deleteAfter(now, chatSandboxTtlHours()),
    lease_until: lease,
    stopped_at: null,
    archived_at: null,
    failure_code: null,
    failure_detail: null,
  });

  await refreshTtl(handle);

  return {
    ok: true,
    handle,
    row: {
      ...claimed,
      state: "running",
      lastActiveAt,
      leaseUntil: lease,
      stoppedAt: null,
      archivedAt: null,
    },
    resumed: true,
    recreated: false,
    notice: start ? "Waking this chat's workspace…" : undefined,
  };
}

export async function openChatSandbox(
  input: OpenInput
): Promise<OpenChatSandboxResult> {
  if (!executionConfigured()) {
    return {
      ok: false,
      failure: "not_configured",
      message: "Execution is not configured on this deployment.",
    };
  }

  const now = input.now ?? Date.now();
  const lease = leaseUntil(now, input.leaseMs);
  const row = await readChatSandbox(input.admin, input.chatId);

  let decision: ChatSandboxOpenDecision;
  try {
    decision = decideChatSandboxOpen({
      row,
      repo: input.repo,
      sha: input.sha,
      now,
    });
  } catch (caught) {
    return { ok: false, failure: "refused", message: messageOf(caught) };
  }

  if (decision === "wait") {
    return { ok: false, failure: "refused", message: WAIT_MESSAGE };
  }

  if (row && (decision === "attach" || decision === "start")) {
    const opened = await resume(input, row, lease, decision === "start");

    if (opened.ok) return opened;

    // A box the provider has forgotten is replaced once. A quota refusal or a
    // failed start that is not a 404 is reported, not retried in a loop.
    if (opened.failure === "missing") {
      await retireRow(input.admin, row);
      return provision(input, lease);
    }

    return opened;
  }

  if (row) {
    // res: a different pin, a failed row, a wiping row, or an orphan.
    await retireRow(input.admin, row);
  }

  return provision(input, lease);
}

/**
 * Ends a turn without destroying the workspace.
 *
 * The box stays running until the idle sweep or the provider's auto-stop
 * timer releases the compute; only the lease, the activity time and the
 * provider deadline are refreshed here.
 */
export async function releaseChatSandbox(input: {
  admin: Admin;
  rowId: string;
  handle?: SandboxHandle | null;
  now?: number;
}): Promise<void> {
  const now = input.now ?? Date.now();

  await releaseChatSandboxRow(input.admin, {
    id: input.rowId,
    lastActiveAt: new Date(now).toISOString(),
    deleteAfter: deleteAfter(now, chatSandboxTtlHours()),
  });

  if (input.handle) await refreshTtl(input.handle);
}

export type { ChatSandboxRow };
