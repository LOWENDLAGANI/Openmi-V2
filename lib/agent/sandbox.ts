import "server-only";

import { chatSandboxesEnabled } from "@/lib/execution/chat-env/lifecycle";
import { openChatSandbox, releaseChatSandbox } from "@/lib/execution/chat-env/open";
import { seedChatWorkspace } from "@/lib/execution/chat-env/seed";
import { createSandbox, type SandboxHandle } from "@/lib/execution/provider";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { MISSION_MAX_OUTPUT_BYTES, MISSION_WORKDIR } from "@/lib/execution/mission/budget";
import {
  MISSION_TOOL_SPECS,
  missionOutput,
  sanitiseWorkspacePath,
  validateCommandArguments,
  type MissionToolDefinition,
} from "@/lib/execution/mission/tools";

import {
  CHAT_SHELL_COMMAND_MS,
  CHAT_SHELL_LIST_MAX,
  CHAT_SHELL_READ_LINES,
  CHAT_SHELL_SEARCH_MAX,
  CHAT_SHELL_TOOL_NAMES,
  describeShellCall,
  isShellTool,
  shellListCommand,
  shellReadCommand,
  shellSearchCommand,
  withLineNumbers,
} from "./shell";
import type { ToolResult } from "./tools";

/**
 * A Linux box a conversation can borrow.
 *
 * With chat environments on, the box belongs to the chat rather than to this
 * invocation: the first tool call opens the chat's workspace, later messages
 * reattach to the same disk, and the turn's end releases the lease instead of
 * destroying anything. With the feature switched off — the rollback path — the
 * old behaviour is kept: one box per turn, destroyed when the answer ends.
 *
 * Either way nothing is provisioned for a message that never needed one, which
 * is the point of putting the decision in the model's hands: "what does this
 * function do" costs a provider call, and "does this build" costs a sandbox.
 *
 * The repository arrives as one tarball at the pinned commit, the same way a
 * verification run seeds one. The sandbox never holds the GitHub token, has no
 * remote configured, and its git history starts at a single `base` commit.
 */

export type ShellTurn = {
  /** The specs to add to this turn's tool surface. */
  specs: MissionToolDefinition[];
  /** True once a sandbox exists — what a turn reports as "it ran something". */
  started: () => boolean;
  commands: () => number;
  run: (name: string, args: Record<string, unknown> | null) => Promise<ToolResult>;
  close: () => Promise<void>;
  /**
   * True when this turn's workspace is the chat's, not the invocation's.
   *
   * The caller uses it to decide whether a paused turn may continue: a
   * continuation of a chat-scoped workspace reattaches to the same disk, while
   * a continuation of a per-message box would reseed and repeat itself.
   */
  retainsWorkspace: () => boolean;
};

export type ShellTurnOptions = {
  token: string | null;
  repo: string | null;
  sha: string | null;
  runId: string;
  /** Epoch ms: no command may start after this, so the response can still close. */
  deadline: number;
  /** The chat this turn belongs to. Required for a persistent workspace. */
  chatId: string | null;
  /** The account that owns the chat; never taken from the request body. */
  owner: string | null;
  /** A fact worth telling the reader (a workspace is waking, for example). */
  onNotice?: (message: string) => void;
};

/**
 * The mission specs, minus the tools a single chat message does not have.
 *
 * Two descriptions are rewritten rather than reused: a mission has background
 * processes and collects a diff at the end, and a chat message has neither. A
 * tool description that promises what the code will not do is how a model ends
 * up telling the user something untrue.
 */
function specs(): MissionToolDefinition[] {
  return MISSION_TOOL_SPECS.filter((tool) =>
    (CHAT_SHELL_TOOL_NAMES as readonly string[]).includes(tool.name)
  ).map((tool) => {
    if (tool.name === "run_command") {
      return {
        ...tool,
        description:
          "Run one shell command in the workspace and wait for it. Returns the exit code and the tail of stdout/stderr. A command that does not exit is stopped at the timeout; this message cannot leave a process running in the background.",
      };
    }

    if (tool.name === "write_file") {
      return {
        ...tool,
        description:
          "Write one whole text file in the workspace, creating parent directories. Nothing is committed, pushed or opened as a pull request; use propose_edits when the user should review a diff.",
      };
    }

    return tool;
  });
}

function failure(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export function createShellTurn(options: ShellTurnOptions): ShellTurn | null {
  if (!options.token || !options.repo || !options.sha) return null;

  // Configuration intent, not the state of the box: a turn that never runs a
  // command still keeps its chat's workspace, so a paused answer may continue.
  const persistent =
    chatSandboxesEnabled() && Boolean(options.chatId) && Boolean(options.owner);

  let sandbox: SandboxHandle | null = null;
  let chatRow: {
    admin: NonNullable<ReturnType<typeof supabaseAdmin>>;
    rowId: string;
  } | null = null;
  let starting: Promise<ToolResult | null> | null = null;
  let commands = 0;
  let closed = false;

  async function ensure(): Promise<ToolResult | null> {
    if (sandbox) return null;
    if (closed) return failure("The sandbox for this turn is already closed.");

    if (!starting) {
      starting = (async () => {
        if (persistent) {
          const admin = supabaseAdmin();

          if (!admin) {
            return failure(
              "This deployment has no database connection for the chat's workspace."
            );
          }

          const opened = await openChatSandbox({
            admin,
            chatId: options.chatId as string,
            owner: options.owner as string,
            repo: options.repo as string,
            sha: options.sha as string,
            token: options.token as string,
          });

          if (!opened.ok) {
            return failure(
              `The Linux sandbox could not be started: ${opened.message}`
            );
          }

          if (opened.notice) options.onNotice?.(opened.notice);

          chatRow = { admin, rowId: opened.row.id };
          sandbox = opened.handle;
          return null;
        }

        let handle: SandboxHandle;
        try {
          handle = await createSandbox(options.runId, {
            // The box only has to outlive this response. If this process dies,
            // the TTL is what stops it from billing anyone after the fact.
            ttlMinutes: 10,
            labels: { kind: "chat" },
          });
        } catch (caught) {
          return failure(
            caught instanceof Error
              ? `The Linux sandbox could not be started: ${caught.message}`
              : "The Linux sandbox could not be started."
          );
        }

        const seeded = await seedChatWorkspace({
          sandbox: handle,
          token: options.token as string,
          repo: options.repo as string,
          sha: options.sha as string,
          chatId: options.chatId ?? options.runId,
        });

        if (!seeded.ok) {
          await handle.destroy();
          return failure(
            `The repository could not be seeded into the sandbox: ${seeded.detail}`
          );
        }

        sandbox = handle;
        return null;
      })();
    }

    return starting;
  }

  async function execDetailed(
    command: string,
    cwd: string,
    timeoutMs: number
  ): Promise<{ ok: true; text: string; failed: boolean; tail: string } | { ok: false; error: string }> {
    const handle = sandbox;
    if (!handle) return failure("The sandbox is not available.");

    commands += 1;

    const result = await handle.exec(command, cwd, timeoutMs);
    const output = missionOutput(result.output, MISSION_MAX_OUTPUT_BYTES);
    const status = `exit ${result.exitCode}${result.timedOut ? " (timed out)" : ""} in ${
      result.durationMs
    }ms`;

    return {
      ok: true,
      // A non-zero exit is information the model must read, not a tool failure
      // it should retry blindly, so the text is complete either way.
      text: `${status}\n${output.text.length > 0 ? output.text : "(no output)"}`,
      failed: result.exitCode !== 0,
      tail: output.text,
    };
  }

  async function run(
    name: string,
    args: Record<string, unknown> | null
  ): Promise<ToolResult> {
    if (!isShellTool(name)) return failure(`unknown tool: ${name}`);
    if (args === null) return failure("bad-input: arguments were not a JSON object");

    if (Date.now() > options.deadline) {
      return failure(
        "The sandbox time budget for this message is spent. Answer with what you already have, and say that the work stopped there."
      );
    }

    const ready = await ensure();
    if (ready) return ready;

    const handle = sandbox;
    if (!handle) return failure("The sandbox is not available.");

    if (name === "run_command") {
      const validated = validateCommandArguments(args);
      if (!validated.ok) return failure(`bad-input: ${validated.error}`);

      const remaining = Math.max(5_000, options.deadline - Date.now());
      const timeout = Math.min(validated.timeoutMs, CHAT_SHELL_COMMAND_MS, remaining);

      return execDetailed(validated.command, validated.cwd || MISSION_WORKDIR, timeout);
    }

    if (name === "read_file") {
      const path = sanitiseWorkspacePath(args.path);
      if (!path) return failure("bad-input: path must be a file inside the workspace");

      const from = Math.max(
        1,
        typeof args.offset === "number" ? Math.trunc(args.offset) : 1
      );
      const limit =
        typeof args.limit === "number"
          ? Math.min(CHAT_SHELL_READ_LINES, Math.max(1, Math.trunc(args.limit)))
          : CHAT_SHELL_READ_LINES;

      const read = await execDetailed(
        shellReadCommand(path, from, from + limit - 1),
        MISSION_WORKDIR,
        30_000
      );

      if (!read.ok) return read;
      if (read.failed) return failure(`${path} could not be read.\n${read.text}`);

      return {
        ok: true,
        text: `${path} (lines ${from}-${from + limit - 1})\n\n${withLineNumbers(read.tail, from)}`,
        tail: read.tail,
      };
    }

    if (name === "write_file") {
      const path = sanitiseWorkspacePath(args.path);
      if (!path) return failure("bad-input: path must be a file inside the workspace");
      if (typeof args.content !== "string") {
        return failure("bad-input: content is required");
      }
      if (args.content.length > 200_000) {
        return failure("bad-input: content is over the 200,000 character cap");
      }

      try {
        await handle.upload(Buffer.from(args.content, "utf8"), `${MISSION_WORKDIR}/${path}`);
      } catch (caught) {
        return failure(
          caught instanceof Error ? caught.message : `${path} could not be written`
        );
      }

      return {
        ok: true,
        text: `${path} written (${args.content.length} characters). Nothing has been committed or pushed.`,
      };
    }

    if (name === "list_files") {
      const path = args.path === undefined ? "" : sanitiseWorkspacePath(args.path);
      if (path === null) return failure("bad-input: path must be a directory inside the workspace");

      const listed = await execDetailed(shellListCommand(path), MISSION_WORKDIR, 30_000);
      if (!listed.ok) return listed;

      if (listed.tail.trim().length === 0) {
        return { ok: true, text: "No files matched.", tail: "" };
      }

      return {
        ok: true,
        text: `${listed.tail.trim().split("\n").length} path(s), up to ${CHAT_SHELL_LIST_MAX}:\n\n${listed.tail.trim()}`,
        tail: listed.tail,
      };
    }

    if (name === "search_files") {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (query.length < 2) return failure("bad-input: query must be at least two characters");

      const path = args.path === undefined ? "" : sanitiseWorkspacePath(args.path);
      if (path === null) return failure("bad-input: path must be a directory inside the workspace");

      const found = await execDetailed(
        shellSearchCommand(query, path),
        MISSION_WORKDIR,
        30_000
      );

      if (!found.ok) return found;

      // grep exits 1 for "no matches", which is an answer, not a failure.
      if (found.failed && found.tail.trim().length === 0) {
        return { ok: true, text: "No matches.", tail: "" };
      }

      return {
        ok: true,
        text: `${found.tail.trim().length > 0 ? `${found.tail.trim().split("\n").length} match(es), up to ${CHAT_SHELL_SEARCH_MAX}` : "No matches."}\n\n${found.tail.trim()}`,
        tail: found.tail,
      };
    }

    return failure(`unknown tool: ${name}`);
  }

  return {
    specs: specs(),
    started: () => sandbox !== null,
    commands: () => commands,
    retainsWorkspace: () => persistent,
    run,
    async close() {
      if (closed) return;
      closed = true;

      // A provisioning call may still be in flight when the answer ends. It is
      // awaited, not abandoned, so the box it creates is the one destroyed
      // rather than one left to its TTL.
      if (starting) {
        try {
          await starting;
        } catch {
          // The failure is already recorded in the turn's step list.
        }
      }

      const handle = sandbox;
      sandbox = null;

      if (!handle) return;

      if (persistent && chatRow) {
        // The disk is the chat's; only this turn's claim on it ends. The sweep
        // stops it after the idle window and wipes it at the 48-hour deadline.
        await releaseChatSandbox({
          admin: chatRow.admin,
          rowId: chatRow.rowId,
          handle,
        });
        return;
      }

      await handle.destroy();
    },
  };
}

/** The label the transcript shows for a tool call. */
export { describeShellCall };
