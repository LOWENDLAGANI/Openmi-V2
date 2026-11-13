import "server-only";

import { checkpointsEnabled } from "@/lib/execution/checkpoints/plan";
import { recordCheckpoint } from "@/lib/execution/checkpoints/session";
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
  BROWSER_COMMAND_MS,
  BROWSER_HOME,
  BROWSER_INSTALL_MS,
  BROWSER_MAX_IMAGE_BYTES,
  BROWSER_SCRIPT_PATH,
  BROWSER_SHOT_DIR,
  BROWSER_TOOL_SPEC,
  BROWSER_VIEWPORT,
  browserInstallCommand,
  browserScript,
  browserShotCommand,
  clampViewport,
  clampWaitMs,
  parseBrowserActions,
  parseShotMeta,
  shotCaption,
  shotReport,
  validateBrowserTarget,
  type BrowserAction,
} from "./browser";
import { FETCH_URL_TOOL_SPEC, fetchUrl } from "./research";
import {
  CHAT_SHELL_COMMAND_MS,
  CHAT_SHELL_LIST_MAX,
  CHAT_SHELL_MAX_COMMANDS,
  CHAT_SHELL_MAX_PROCESSES,
  CHAT_SHELL_PROCESS_LINES,
  CHAT_SHELL_READ_LINES,
  CHAT_SHELL_SEARCH_MAX,
  CHAT_SHELL_TOOL_NAMES,
  chatProcessId,
  describeShellCall,
  isChatProcessId,
  isShellTool,
  killProcessCommand,
  readProcessCommand,
  shellListCommand,
  shellReadCommand,
  shellSearchCommand,
  startProcessCommand,
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
  const base = MISSION_TOOL_SPECS.filter((tool) =>
    (CHAT_SHELL_TOOL_NAMES as readonly string[]).includes(tool.name)
  ).map((tool) => {
    if (tool.name === "run_command") {
      return {
        ...tool,
        description:
          "Run one shell command in the workspace and wait for it. Returns the exit code and the tail of stdout/stderr. A command that does not exit is stopped at the timeout; use start_process for anything that should keep running.",
      };
    }

    if (tool.name === "start_process") {
      return {
        ...tool,
        description:
          "Start a command in the background (a dev server, a watcher, a build you want to inspect while it runs) and get an id. It keeps running after this call. Read its output with read_process and stop it with kill_process. A workspace that survives this message keeps the process too; a per-message sandbox stops it when the answer ends.",
      };
    }

    if (tool.name === "read_process") {
      return {
        ...tool,
        description:
          "Read the tail of a background process started with start_process, including anything it printed since the last read.",
      };
    }

    if (tool.name === "kill_process") {
      return {
        ...tool,
        description:
          "Stop a background process started with start_process, and everything it spawned, so its port is free.",
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

  // The browser is a chat tool, not a mission tool: a mission answers a goal in
  // the workspace it was given, while a page is a question about something
  // outside it. `fetch_url` is the cheaper half of the same idea — one page of
  // text instead of a page driven by script.
  return [
    ...base,
    FETCH_URL_TOOL_SPEC as unknown as MissionToolDefinition,
    BROWSER_TOOL_SPEC as unknown as MissionToolDefinition,
  ];
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
  /** Processes this message started, for the cap and for the stop on close. */
  const processes = new Set<string>();

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

  /**
   * Drive the page, then photograph where the turn ended up.
   *
   * The install is lazy and shared by every turn on this box: the first call
   * pays for Chromium and the rest reuse it. The plan is written as a file and
   * never as a command-line argument, so a filled password stays out of argv
   * and out of every message the transcript prints. The image is read back
   * through the provider rather than through command output, which is capped
   * and would truncate a JPEG.
   */
  async function browse(
    handle: SandboxHandle,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const allowed = [
      "url",
      "actions",
      "full_page",
      "width",
      "height",
      "wait_ms",
      "purpose",
    ];

    if (!Object.keys(args).every((key) => allowed.includes(key))) {
      return failure("bad-input: unexpected argument");
    }

    const parsed = parseBrowserActions(args.actions);
    if (!parsed.ok) return failure(`bad-input: ${parsed.error}`);

    // The URL is optional: a later call continues on the page the session is
    // already showing, the way a second click does not renavigate.
    const hasUrl = typeof args.url === "string" && args.url.trim().length > 0;
    const target = hasUrl ? validateBrowserTarget(args.url) : null;

    if (hasUrl && !target) {
      return failure("bad-input: url must be an http(s) address");
    }

    const actions: BrowserAction[] = [
      ...(target ? [{ type: "goto" as const, url: target.url }] : []),
      ...parsed.actions,
    ];

    if (actions.length === 0) {
      return failure("bad-input: give a url, an action, or both");
    }

    if (Date.now() > options.deadline) {
      return failure(
        "The sandbox time budget for this message is spent. Answer with what you already have, and say that the page was not opened."
      );
    }

    const remaining = Math.max(5_000, options.deadline - Date.now());
    const width = clampViewport(args.width, BROWSER_VIEWPORT.width);
    const height = clampViewport(args.height, BROWSER_VIEWPORT.height);
    const waitMs = clampWaitMs(args.wait_ms);
    const fullPage = args.full_page === true;
    const stamp = Date.now();
    const outputPath = `${BROWSER_SHOT_DIR}/shot-${stamp}.jpg`;
    const planPath = `${BROWSER_SHOT_DIR}/plan-${stamp}.json`;

    const installed = await handle.exec(
      browserInstallCommand(),
      BROWSER_HOME,
      Math.min(BROWSER_INSTALL_MS, remaining)
    );

    if (installed.exitCode !== 0) {
      return failure(
        `The headless browser could not be installed. This sandbox may refuse its downloads.\n${installed.output}`
      );
    }

    try {
      await handle.upload(Buffer.from(browserScript(), "utf8"), BROWSER_SCRIPT_PATH);
      await handle.upload(
        Buffer.from(JSON.stringify({ actions }), "utf8"),
        planPath
      );
    } catch (caught) {
      return failure(
        caught instanceof Error
          ? `The browser script could not be written: ${caught.message}`
          : "The browser script could not be written."
      );
    }

    const ran = await handle.exec(
      browserShotCommand({ planPath, outputPath, width, height, fullPage, waitMs }),
      BROWSER_HOME,
      Math.min(BROWSER_COMMAND_MS, remaining)
    );

    // Both files are transport, not workspace state: the shot would fill the
    // disk and show up in `git status`, and the plan holds whatever was typed.
    const cleanup = () => {
      void handle
        .exec(`rm -f ${outputPath} ${planPath}`, BROWSER_HOME, 10_000)
        .catch(() => {});
    };

    const meta = parseShotMeta(ran.output);

    if (!meta) {
      cleanup();
      return failure(`The browser produced no snapshot.\n${ran.output}`);
    }

    if (!meta.ok) {
      cleanup();
      return failure(
        `The browser could not run: ${meta.error ?? "the browser reported a failure"}`
      );
    }

    let bytes: Buffer;
    try {
      bytes = await handle.readBytes(outputPath, BROWSER_MAX_IMAGE_BYTES);
    } catch (caught) {
      cleanup();
      return failure(
        caught instanceof Error
          ? `The screenshot could not be read: ${caught.message}`
          : "The screenshot could not be read."
      );
    }

    cleanup();

    const report = shotReport(meta, bytes.byteLength);

    return {
      ok: true,
      text: report,
      tail: report,
      image: {
        mime: "image/jpeg",
        base64: bytes.toString("base64"),
        caption: shotCaption(meta),
      },
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

    // A page is read here, not in the box: no workspace is needed to fetch text,
    // so a research-only turn never provisions one, and the address is checked
    // against the SSRF rules in this process rather than by a shell.
    if (name === "fetch_url") {
      return fetchUrl(args);
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

    if (name === "start_process") {
      const validated = validateCommandArguments(args);
      if (!validated.ok) return failure(`bad-input: ${validated.error}`);

      if (commands >= CHAT_SHELL_MAX_COMMANDS) {
        return failure(
          `This message has used its ${CHAT_SHELL_MAX_COMMANDS}-command budget.`
        );
      }

      if (processes.size >= CHAT_SHELL_MAX_PROCESSES) {
        return failure(
          `This message can start ${CHAT_SHELL_MAX_PROCESSES} background processes at a time; stop one with kill_process first.`
        );
      }

      const id = chatProcessId();
      const cwd = validated.cwd
        ? `${MISSION_WORKDIR}/${validated.cwd}`
        : MISSION_WORKDIR;

      const started = await execDetailed(
        startProcessCommand(validated.command, id),
        cwd,
        30_000
      );

      if (!started.ok) return started;
      if (started.failed) {
        return failure(`The process could not be started.\n${started.text}`);
      }

      processes.add(id);

      return {
        ok: true,
        text: `Started ${id} (${validated.purpose}). It runs in the background; read it with read_process and stop it with kill_process.`,
      };
    }

    if (name === "read_process") {
      if (!isChatProcessId(args.id)) {
        return failure("bad-input: id must be the value start_process returned");
      }

      const lines =
        typeof args.lines === "number"
          ? Math.min(CHAT_SHELL_PROCESS_LINES, Math.max(1, Math.trunc(args.lines)))
          : 80;

      const read = await execDetailed(
        readProcessCommand(args.id, lines),
        MISSION_WORKDIR,
        30_000
      );

      if (!read.ok) return read;

      return {
        ok: true,
        text: `${args.id}, last ${lines} line(s)\n\n${read.tail.length > 0 ? read.tail : "(no output yet)"}`,
        tail: read.tail,
      };
    }

    if (name === "kill_process") {
      if (!isChatProcessId(args.id)) {
        return failure("bad-input: id must be the value start_process returned");
      }

      const killed = await execDetailed(
        killProcessCommand(args.id),
        MISSION_WORKDIR,
        30_000
      );

      if (!killed.ok) return killed;

      processes.delete(args.id);

      return { ok: true, text: killed.text, tail: killed.tail };
    }

    if (name === "list_files") {
      // The workspace root is spelled "", ".", "./" or "/" depending on how
      // the model phrases it; all four are the same directory, and refusing one
      // of them would answer "what is in the root" with an error instead.
      const asked = args.path;
      const path =
        asked === undefined || asked === "" || asked === "." || asked === "./" || asked === "/"
          ? ""
          : sanitiseWorkspacePath(asked);
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

    if (name === "browser") {
      return browse(handle, args);
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
        // A turn that changed files leaves a version behind before its lease
        // ends. It is best effort on purpose: the answer is already written, and
        // a checkpoint that fails must not turn a finished turn into an error.
        try {
          if (checkpointsEnabled()) {
            await recordCheckpoint({
              admin: chatRow.admin,
              chatId: options.chatId as string,
              owner: options.owner as string,
              sandboxId: handle.id,
              handle,
            });
          }
        } catch {
          // The next turn makes its own version; GitHub remains the record that
          // survives the box.
        }

        // The disk is the chat's; only this turn's claim on it ends. The sweep
        // stops it after the idle window and wipes it at the chat TTL deadline.
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
