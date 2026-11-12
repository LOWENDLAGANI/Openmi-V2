import "server-only";

import { shellListCommand, shellQuote } from "@/lib/agent/shell";
import {
  isLeaseLive,
} from "@/lib/execution/chat-env/lifecycle";
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
  EDITOR_MAX_BYTES,
  EDITOR_MAX_FILES,
  editorPath,
  isProbablyBinary,
  relativeToWorkspace,
  textFitsWorkspaceFile,
} from "./plan";

/**
 * Reading and saving files in a chat's workspace.
 *
 * The workspace is the chat's sandbox clone, so an edit is a change on
 * `openmi/work/<chat>` and nothing else: no commit, no push, no credential. It
 * becomes a version on the next turn (the turn hook commits), and it reaches
 * GitHub only through a change request, which is why the panel says so.
 *
 * A save is refused while a turn holds the lease. The turn may be writing the
 * same file, and the last writer would silently win.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

const REPO_DIR = MISSION_WORKDIR;

const NO_WORKSPACE =
  "This chat has no workspace yet. Send a message that needs the sandbox first.";

const BUSY =
  "A turn is using this chat's workspace. Save when it finishes.";

export type FileResult<T> =
  | ({ ok: true } & T)
  | { ok: false; message: string };

type Opened =
  | { ok: true; row: ChatSandboxRow; handle: SandboxHandle }
  | { ok: false; message: string };

function messageOf(caught: unknown): string {
  if (caught instanceof SandboxStartError) return caught.message;
  return caught instanceof Error && caught.message.length > 0
    ? caught.message
    : "The sandbox could not be reached.";
}

async function openWorkspace(input: {
  admin: Admin;
  chatId: string;
  owner: string;
}): Promise<Opened> {
  const row = await readChatSandbox(input.admin, input.chatId);

  if (!row || row.owner !== input.owner) {
    return { ok: false, message: NO_WORKSPACE };
  }

  if (row.state === "provisioning" || row.state === "wiping") {
    return {
      ok: false,
      message: "This chat's workspace is being prepared. Try again in a moment.",
    };
  }

  try {
    const handle = await attachSandbox(row.sandboxId);
    await handle.start(90);
    return { ok: true, row, handle };
  } catch (caught) {
    return { ok: false, message: messageOf(caught) };
  }
}

export async function listWorkspaceFiles(input: {
  admin: Admin;
  chatId: string;
  owner: string;
}): Promise<FileResult<{ files: string[] }>> {
  const opened = await openWorkspace(input);
  if (!opened.ok) return opened;

  const listing = await opened.handle.exec(
    shellListCommand(REPO_DIR),
    ".",
    30_000
  );

  if (listing.exitCode !== 0) {
    return {
      ok: false,
      message: listing.output.trim() || "The workspace could not be listed.",
    };
  }

  const files = listing.output
    .split("\n")
    .map((line) => relativeToWorkspace(line, REPO_DIR))
    .filter((path): path is string => path !== null)
    .slice(0, EDITOR_MAX_FILES);

  return { ok: true, files };
}

export async function readWorkspaceFile(input: {
  admin: Admin;
  chatId: string;
  owner: string;
  path: unknown;
}): Promise<FileResult<{ path: string; text: string; bytes: number }>> {
  const relative = editorPath(input.path);

  if (!relative) {
    return {
      ok: false,
      message: "That path is not a file inside this chat's workspace.",
    };
  }

  const opened = await openWorkspace(input);
  if (!opened.ok) return opened;

  let text: string;
  try {
    // The reader refuses rather than truncates, so a save can never quietly
    // write back a shortened file.
    text = await opened.handle.readText(
      `${REPO_DIR}/${relative}`,
      EDITOR_MAX_BYTES
    );
  } catch (caught) {
    return {
      ok: false,
      message:
        caught instanceof Error && caught.message.length > 0
          ? caught.message
          : `That file could not be read, or it is larger than ${EDITOR_MAX_BYTES} bytes.`,
    };
  }

  if (isProbablyBinary(text)) {
    return { ok: false, message: "That file is binary; the editor reads text only." };
  }

  return {
    ok: true,
    path: relative,
    text,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

export async function writeWorkspaceFile(input: {
  admin: Admin;
  chatId: string;
  owner: string;
  path: unknown;
  text: unknown;
}): Promise<FileResult<{ path: string; bytes: number }>> {
  const relative = editorPath(input.path);

  if (!relative) {
    return {
      ok: false,
      message: "That path is not a file inside this chat's workspace.",
    };
  }

  if (typeof input.text !== "string") {
    return { ok: false, message: "The file content must be text." };
  }

  if (!textFitsWorkspaceFile(input.text)) {
    return {
      ok: false,
      message: `That file is larger than the ${EDITOR_MAX_BYTES} byte editor cap, so nothing was written.`,
    };
  }

  const opened = await openWorkspace(input);
  if (!opened.ok) return opened;

  if (isLeaseLive(opened.row.leaseUntil)) {
    return { ok: false, message: BUSY };
  }

  const parent = relative.split("/").slice(0, -1).join("/");

  if (parent.length > 0) {
    // A new file in a new directory is still a file the reader asked for; the
    // upload API writes a file, not a tree.
    const made = await opened.handle.exec(
      `mkdir -p ${shellQuote(parent)}`,
      REPO_DIR,
      20_000
    );

    if (made.exitCode !== 0) {
      return {
        ok: false,
        message: made.output.trim() || "The directory could not be created.",
      };
    }
  }

  try {
    await opened.handle.upload(
      Buffer.from(input.text, "utf8"),
      `${REPO_DIR}/${relative}`
    );
  } catch (caught) {
    return {
      ok: false,
      message:
        caught instanceof Error && caught.message.length > 0
          ? caught.message
          : "The file could not be written.",
    };
  }

  return {
    ok: true,
    path: relative,
    bytes: Buffer.byteLength(input.text, "utf8"),
  };
}
