import "server-only";

import {
  chatProcessLogPath,
  killProcessCommand,
  startProcessCommand,
} from "@/lib/agent/shell";
import {
  readChatSandbox,
  type ChatSandboxRow,
} from "@/lib/execution/chat-env/store";
import { MISSION_WORKDIR } from "@/lib/execution/mission/budget";
import {
  attachSandbox,
  SandboxStartError,
  type SandboxHandle,
} from "@/lib/execution/provider";
import { supabaseAdmin } from "@/lib/supabase/admin";

import { isLeaseLive } from "@/lib/execution/chat-env/lifecycle";

import {
  PREVIEW_IDLE_STOP_MINUTES,
  PREVIEW_MAX_LOG_LINES,
  PREVIEW_MAX_MINUTES_PER_CHAT,
  PREVIEW_READY_TIMEOUT_MS,
  detectDevServer,
  isPreviewProcessId,
  previewExpiry,
  previewProcessId,
  readinessCommand,
} from "./plan";
import { readChatPreview, writeChatPreview } from "./store";

/**
 * Starting and stopping the dev server one chat is previewing.
 *
 * It runs inside the chat's existing sandbox, with the same process primitives
 * the shell tool uses: `setsid`, a log under `/tmp/openmi-chat`, and a kill that
 * stops the process group. Nothing here creates a box, so a preview cannot cost
 * a second workspace, and nothing here writes to the repository, so a preview
 * cannot appear in a diff.
 *
 * The box is attached, not leased. A preview needs the disk for a few seconds
 * to spawn a process; the process then belongs to the sandbox and survives the
 * request. A turn that holds the lease is not disturbed, and a preview never
 * blocks a turn.
 */

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

export type PreviewFailure =
  | "no_workspace"
  | "not_ready"
  | "no_dev_script"
  | "start_failed"
  | "provider";

export type PreviewStartResult =
  | { ok: true; url: string; port: number; command: string }
  | { ok: false; failure: PreviewFailure; message: string };

/** The repository's directory inside the sandbox user's home. */
const REPO_DIR = MISSION_WORKDIR;

const NO_WORKSPACE =
  "This chat has no workspace yet. Send a message that needs the sandbox first, then start the preview.";

const NOT_READY =
  "This chat's workspace is being prepared in another tab. Try the preview again in a moment.";

const LOCKFILES = [
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
];

function messageOf(caught: unknown): string {
  if (caught instanceof SandboxStartError) return caught.message;
  return caught instanceof Error && caught.message.length > 0
    ? caught.message
    : "The preview could not reach the sandbox.";
}

/**
 * `getHost` returns a hostname, not a URL. Prefixing here keeps the one place
 * that builds a preview URL from also being the place that decides its scheme,
 * which is what a future private-traffic proxy will change.
 */
function previewUrl(handle: SandboxHandle, port: number): string {
  const host = handle.host(port).trim();
  return /^https?:\/\//i.test(host) ? host : `https://${host}`;
}

async function readPackageJson(handle: SandboxHandle): Promise<unknown> {
  try {
    return JSON.parse(
      await handle.readText(`${REPO_DIR}/package.json`, 200_000)
    );
  } catch {
    return null;
  }
}

/** The lockfiles that exist, because the runner is chosen from them. */
async function readLockfiles(handle: SandboxHandle): Promise<string[]> {
  const probe = await handle.exec(
    `for f in ${LOCKFILES.join(" ")}; do [ -f ${REPO_DIR}/$f ] && echo $f; done`,
    ".",
    20_000
  );

  return probe.output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function stopProcess(
  handle: SandboxHandle,
  processId: string | null
): Promise<void> {
  if (!isPreviewProcessId(processId)) return;

  try {
    await handle.exec(killProcessCommand(processId), REPO_DIR, 20_000);
  } catch {
    // The port may already be free, and the box's own lifetime is the backstop.
    // A failed kill must not turn a stop into a failed state.
  }
}

async function logTail(
  handle: SandboxHandle,
  processId: string
): Promise<string> {
  try {
    const tail = await handle.exec(
      `tail -n ${PREVIEW_MAX_LOG_LINES} ${chatProcessLogPath(processId)} 2>/dev/null`,
      REPO_DIR,
      20_000
    );

    const text = tail.output.trim();
    return text.length > 0 ? text.slice(-2_000) : "The dev server produced no output.";
  } catch {
    return "The dev server produced no readable output.";
  }
}

/**
 * Attaches to the chat's box and makes sure it is running.
 *
 * `attachSandbox` resumes a paused box on connect, and `start` is a no-op for a
 * running one, so a preview after a quiet night costs one wake.
 */
async function attachChatBox(
  row: ChatSandboxRow
): Promise<SandboxHandle> {
  const handle = await attachSandbox(row.sandboxId);
  await handle.start(90);
  return handle;
}

export async function startChatPreview(input: {
  admin: Admin;
  chatId: string;
  owner: string;
}): Promise<PreviewStartResult> {
  const sandboxRow = await readChatSandbox(input.admin, input.chatId);

  if (!sandboxRow || sandboxRow.owner !== input.owner) {
    return { ok: false, failure: "no_workspace", message: NO_WORKSPACE };
  }

  if (sandboxRow.state === "provisioning" || sandboxRow.state === "wiping") {
    return { ok: false, failure: "not_ready", message: NOT_READY };
  }

  let handle: SandboxHandle;
  try {
    handle = await attachChatBox(sandboxRow);
  } catch (caught) {
    return { ok: false, failure: "provider", message: messageOf(caught) };
  }

  // A second click, or a start after a crash: one chat, one dev server. The
  // process this chat already owns is stopped before another is started, so a
  // stray server cannot keep a port and a log nobody reads.
  const existing = await readChatPreview(input.admin, input.chatId);
  await stopProcess(handle, existing?.processId ?? null);

  const detection = detectDevServer({
    paths: await readLockfiles(handle),
    packageJson: await readPackageJson(handle),
  });

  if (!detection.ok) {
    await writeChatPreview(input.admin, {
      chatId: input.chatId,
      owner: input.owner,
      sandboxId: sandboxRow.sandboxId,
      state: "failed",
      failureDetail: detection.reason,
      stoppedAt: new Date().toISOString(),
    });

    return { ok: false, failure: "no_dev_script", message: detection.reason };
  }

  const { command, port } = detection.plan;
  const processId = previewProcessId();

  await writeChatPreview(input.admin, {
    chatId: input.chatId,
    owner: input.owner,
    sandboxId: sandboxRow.sandboxId,
    state: "starting",
    processId,
    port,
    command,
    startedAt: new Date().toISOString(),
  });

  try {
    // The command is backgrounded by `startProcessCommand`, so this returns as
    // soon as the shell has forked it. The probe below is what waits.
    await handle.exec(startProcessCommand(command, processId), REPO_DIR, 30_000);
  } catch (caught) {
    const detail = messageOf(caught);

    await writeChatPreview(input.admin, {
      chatId: input.chatId,
      owner: input.owner,
      sandboxId: sandboxRow.sandboxId,
      state: "failed",
      processId,
      port,
      command,
      failureDetail: detail,
      stoppedAt: new Date().toISOString(),
    });

    return { ok: false, failure: "start_failed", message: detail };
  }

  const probed = await handle.exec(
    readinessCommand(port),
    REPO_DIR,
    PREVIEW_READY_TIMEOUT_MS + 10_000
  );

  if (probed.exitCode !== 0) {
    // A server that never answered is stopped before the failure is recorded:
    // leaving it running would hold the port and keep billing compute for a
    // preview nobody can open.
    const detail = await logTail(handle, processId);
    await stopProcess(handle, processId);

    await writeChatPreview(input.admin, {
      chatId: input.chatId,
      owner: input.owner,
      sandboxId: sandboxRow.sandboxId,
      state: "failed",
      port,
      command,
      failureDetail: detail,
      stoppedAt: new Date().toISOString(),
    });

    return { ok: false, failure: "start_failed", message: detail };
  }

  let url: string;
  try {
    url = previewUrl(handle, port);
  } catch (caught) {
    await stopProcess(handle, processId);
    return { ok: false, failure: "provider", message: messageOf(caught) };
  }

  await writeChatPreview(input.admin, {
    chatId: input.chatId,
    owner: input.owner,
    sandboxId: sandboxRow.sandboxId,
    state: "ready",
    processId,
    port,
    command,
    url,
    startedAt: new Date().toISOString(),
  });

  return { ok: true, url, port, command };
}

export async function stopChatPreview(input: {
  admin: Admin;
  chatId: string;
  owner: string;
  /** Set when a limit ended it, so the panel can say which one. */
  reason?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const preview = await readChatPreview(input.admin, input.chatId);

  if (!preview) return { ok: true };
  if (preview.owner !== input.owner) {
    return { ok: false, message: "That preview belongs to another account." };
  }

  const sandboxRow = await readChatSandbox(input.admin, input.chatId);

  if (sandboxRow) {
    try {
      const handle = await attachChatBox(sandboxRow);
      await stopProcess(handle, preview.processId);
    } catch {
      // The box is gone or unreachable, so the process is gone with it. The row
      // still has to move to stopped, or the panel would offer to stop a server
      // that no longer exists.
    }
  }

  await writeChatPreview(input.admin, {
    chatId: input.chatId,
    owner: input.owner,
    sandboxId: preview.sandboxId,
    state: "stopped",
    stopReason: input.reason ?? null,
    stoppedAt: new Date().toISOString(),
  });

  return { ok: true };
}

export type PreviewEnforcement =
  | { stopped: false }
  | { stopped: true; reason: string };

export function expiryReason(expiry: "max-lifetime" | "idle"): string {
  return expiry === "max-lifetime"
    ? `Stopped after ${PREVIEW_MAX_MINUTES_PER_CHAT} minutes. Start it again when you need it.`
    : `Stopped after ${PREVIEW_IDLE_STOP_MINUTES} minutes with nobody looking.`;
}

/**
 * Stops a preview that has outlived its limits.
 *
 * Enforced lazily, on the reads the panel already makes, because a daily cron
 * cannot police an hour: the status route calls this before it answers, and a
 * start stops the previous server anyway. A live lease is left alone — a turn is
 * using the box, and stopping a server underneath it is not this function's
 * judgement to make.
 */
export async function enforcePreviewExpiry(input: {
  admin: Admin;
  chatId: string;
  owner: string;
}): Promise<PreviewEnforcement> {
  const preview = await readChatPreview(input.admin, input.chatId);

  if (!preview || preview.owner !== input.owner) return { stopped: false };

  const expiry = previewExpiry(preview);
  if (expiry === "none") return { stopped: false };

  const sandboxRow = await readChatSandbox(input.admin, input.chatId);

  if (sandboxRow && isLeaseLive(sandboxRow.leaseUntil)) {
    return { stopped: false };
  }

  const reason = expiryReason(expiry);

  if (sandboxRow) {
    try {
      const handle = await attachChatBox(sandboxRow);
      await stopProcess(handle, preview.processId);
    } catch {
      // The box is gone, so the server is gone with it; the row still moves.
    }
  }

  await writeChatPreview(input.admin, {
    chatId: input.chatId,
    owner: preview.owner,
    sandboxId: preview.sandboxId,
    state: "stopped",
    stopReason: reason,
    stoppedAt: new Date().toISOString(),
  });

  return { stopped: true, reason };
}
