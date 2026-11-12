import "server-only";

import {
  isLeaseLive,
  toMillis,
} from "@/lib/execution/chat-env/lifecycle";
import { readChatSandbox } from "@/lib/execution/chat-env/store";
import { MISSION_WORKDIR } from "@/lib/execution/mission/budget";
import { attachSandbox } from "@/lib/execution/provider";
import { resolveBranchSha } from "@/lib/github/read";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

import { changedFileCount } from "@/lib/execution/checkpoints/plan";

import { syncVerdict, type SyncVerdict } from "./plan";

/**
 * Moving a chat's pin to the branch head.
 *
 * The pull itself is a database write, not a sandbox write: the pin moves, and
 * the next turn's `openChatSandbox` sees a different commit and reseeds. That
 * keeps one path for "the workspace is stale" instead of adding a second reset
 * that could disagree with the resolver.
 *
 * It refuses while a turn holds the lease and while the workspace has
 * uncommitted files, because both are work a reseed would silently discard.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;
type SessionClient = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

const REPO_DIR = MISSION_WORKDIR;

export type SyncResult =
  | {
      ok: true;
      verdict: "up-to-date" | "pull";
      head: string;
      previous: string | null;
    }
  | { ok: false; verdict: Exclude<SyncVerdict, "pull" | "up-to-date">; message: string };

type ChatPin = {
  repo_full_name: string | null;
  repo_branch: string | null;
  repo_base_sha: string | null;
};

async function readPin(
  supabase: SessionClient,
  chatId: string
): Promise<ChatPin | null> {
  const { data } = await supabase
    .from("chats")
    .select("repo_full_name, repo_branch, repo_base_sha")
    .eq("id", chatId)
    .maybeSingle();

  return (data as ChatPin | null) ?? null;
}

async function countDirty(admin: Admin, chatId: string): Promise<number> {
  const row = await readChatSandbox(admin, chatId);
  if (!row) return 0;

  try {
    const handle = await attachSandbox(row.sandboxId);
    await handle.start(90);
    const status = await handle.exec("git status --porcelain", REPO_DIR, 20_000);

    return status.exitCode === 0 ? changedFileCount(status.output) : 0;
  } catch {
    // A box that cannot be reached holds nothing this pull could destroy, so the
    // pull is allowed; the resolver will reseed a fresh workspace either way.
    return 0;
  }
}

export async function pullChatBranch(input: {
  admin: Admin;
  supabase: SessionClient;
  chatId: string;
  token: string;
  /**
   * Set only for a pull the agent starts inside its own turn.
   *
   * The turn holds the workspace lease, so the ordinary refusal would make the
   * tool unusable by construction. The uncommitted check still runs: that is
   * the condition a reseed would actually destroy.
   */
  allowDuringTurn?: boolean;
}): Promise<SyncResult> {
  const pin = await readPin(input.supabase, input.chatId);

  if (!pin?.repo_full_name || !pin.repo_branch) {
    return {
      ok: false,
      verdict: "no-repository",
      message: "Attach a repository to this chat before pulling its branch.",
    };
  }

  let head: string;
  try {
    head = await resolveBranchSha(
      input.token,
      pin.repo_full_name,
      pin.repo_branch
    );
  } catch (caught) {
    return {
      ok: false,
      verdict: "no-repository",
      message:
        caught instanceof Error && caught.message.length > 0
          ? caught.message
          : "GitHub could not read that branch.",
    };
  }

  const row = await readChatSandbox(input.admin, input.chatId);
  const now = Date.now();

  // A provisioning row is a turn in the middle of seeding, and an expired
  // `last_active_at` says nothing about who is holding the box — the lease does.
  const provisioning =
    row?.state === "provisioning" ||
    row?.state === "wiping" ||
    (row !== null && toMillis(row.lastActiveAt) === null);

  const leaseLive = row ? isLeaseLive(row.leaseUntil, now) : false;

  const quick = syncVerdict({
    pinnedSha: pin.repo_base_sha,
    headSha: head,
    leaseLive,
    provisioning: Boolean(provisioning),
    dirtyFiles: 0,
  });

  if (quick === "up-to-date") {
    return { ok: true, verdict: "up-to-date", head, previous: pin.repo_base_sha };
  }

  if (quick === "busy" && !input.allowDuringTurn) {
    return {
      ok: false,
      verdict: "busy",
      message:
        "A turn is preparing or using this chat's workspace. Pull the branch when it finishes.",
    };
  }

  if (quick === "pull" || quick === "busy") {
    const dirtyFiles = await countDirty(input.admin, input.chatId);

    if (dirtyFiles > 0) {
      return {
        ok: false,
        verdict: "uncommitted",
        message: `${dirtyFiles} file${dirtyFiles === 1 ? "" : "s"} in the workspace have uncommitted changes. Save or discard them before pulling, because the workspace is reseeded from the branch.`,
      };
    }
  }

  const { error } = await input.supabase
    .from("chats")
    .update({
      repo_base_sha: head,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.chatId);

  if (error) {
    return {
      ok: false,
      verdict: "no-repository",
      message: error.message,
    };
  }

  return { ok: true, verdict: "pull", head, previous: pin.repo_base_sha };
}

export type GitState =
  | {
      ok: true;
      branch: string;
      pinned: string;
      head: string;
      behind: boolean;
      dirtyFiles: number;
    }
  | { ok: false; message: string };

/**
 * The chat's git state, for the agent's `git status`.
 *
 * One branch read against the pin, plus the workspace's uncommitted count. It
 * writes nothing, so it is safe to call in the middle of a turn: the answer is
 * the same shape the Versions panel shows, and nothing is reseeded by looking.
 */
export async function readGitStatus(input: {
  admin: Admin;
  supabase: SessionClient;
  chatId: string;
  token: string;
}): Promise<GitState> {
  const pin = await readPin(input.supabase, input.chatId);

  if (!pin?.repo_full_name || !pin.repo_branch || !pin.repo_base_sha) {
    return {
      ok: false,
      message: "Attach a repository to this chat before asking about git.",
    };
  }

  let head: string;
  try {
    head = await resolveBranchSha(
      input.token,
      pin.repo_full_name,
      pin.repo_branch
    );
  } catch (caught) {
    return {
      ok: false,
      message:
        caught instanceof Error && caught.message.length > 0
          ? caught.message
          : "GitHub could not read that branch.",
    };
  }

  return {
    ok: true,
    branch: pin.repo_branch,
    pinned: pin.repo_base_sha,
    head,
    behind: pin.repo_base_sha !== head,
    dirtyFiles: await countDirty(input.admin, input.chatId),
  };
}

