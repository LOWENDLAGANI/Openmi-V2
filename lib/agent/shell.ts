/**
 * The shell tools a chat turn may call, and the caps they run under.
 *
 * Pure: no database, no provider, no `server-only`. The tests read the same
 * constants the sandbox does, so a limit cannot drift between the thing that
 * enforces it and the thing that describes it.
 *
 * The product decision this file encodes: the composer has one input. A model
 * that needs to run something calls `run_command`; a model that already knows
 * the answer types one. There is no mode to pick and no second surface to
 * watch, so the tool descriptions are the whole of the user's affordance.
 */

export const CHAT_SHELL_TOOL_NAMES = [
  "run_command",
  "read_file",
  "write_file",
  "list_files",
  "search_files",
  // A terminal is not only commands that exit. A dev server or a watcher is
  // started, read and stopped, the same way a person uses one, and the three
  // calls are separate because each one returns before the next is decided.
  "start_process",
  "read_process",
  "kill_process",
  // The headless browser is part of the same box, so it is part of the same
  // surface: a question about a page is answered by looking at the page.
  "browser",
] as const;

export type ChatShellToolName = (typeof CHAT_SHELL_TOOL_NAMES)[number];

/** Commands one message may run. A chat turn is a question, not a build farm. */
export const CHAT_SHELL_MAX_COMMANDS = 40;

/** Wall clock the sandbox may consume inside one turn. */
export const CHAT_SHELL_BUDGET_MS = 200_000;

/** One command's ceiling, inside the turn's own budget. */
export const CHAT_SHELL_COMMAND_MS = 120_000;

/** Background processes one message may start before it has to stop one. */
export const CHAT_SHELL_MAX_PROCESSES = 4;

/** Lines one read of a process log returns. */
export const CHAT_SHELL_PROCESS_LINES = 200;

/**
 * Where a chat's background processes keep their log and pid file.
 *
 * Deliberately outside the workspace: the same files inside the repository
 * would show up as an untracked change in the diff the user is asked to
 * review. `/tmp` is one of the sandbox's writable roots and is gone with the
 * box, so a process that outlives its message cannot outlive its disk.
 */
export const CHAT_PROCESS_DIR = "/tmp/openmi-chat";

export const CHAT_SHELL_READ_LINES = 200;
export const CHAT_SHELL_LIST_MAX = 300;
export const CHAT_SHELL_SEARCH_MAX = 40;

/** Shell-quote one argument, so a path or query can never become a second word. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function isShellTool(name: string): name is ChatShellToolName {
  return (CHAT_SHELL_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * The row the transcript shows. A model-written `purpose` beats a command
 * echo, because "install dependencies" is what the reader wants in a step list;
 * the command itself belongs behind the fold.
 */
export function describeShellCall(
  name: string,
  args: Record<string, unknown>
): string {
  if (name === "run_command") {
    const purpose = typeof args.purpose === "string" ? args.purpose.trim() : "";
    if (purpose.length > 0) return purpose;
    const command = typeof args.command === "string" ? args.command.trim() : "";
    return command.length > 0 ? command : "run a command";
  }

  if (name === "read_file" || name === "write_file") {
    const path = typeof args.path === "string" ? args.path : "";
    return path.length > 0
      ? `${name === "read_file" ? "Read" : "Write"} ${path}`
      : name;
  }

  if (name === "list_files") {
    const path = typeof args.path === "string" && args.path.length > 0 ? args.path : "the workspace";
    return `List ${path}`;
  }

  if (name === "search_files" && typeof args.query === "string") {
    return `Search for ${JSON.stringify(args.query)}`;
  }

  if (name === "start_process") {
    const purpose = typeof args.purpose === "string" ? args.purpose.trim() : "";
    if (purpose.length > 0) return purpose;
    const command = typeof args.command === "string" ? args.command.trim() : "";
    return command.length > 0 ? `Start ${command}` : "Start a process";
  }

  if (name === "read_process" || name === "kill_process") {
    const id = typeof args.id === "string" ? args.id : "";
    const verb = name === "read_process" ? "Read" : "Stop";
    return id.length > 0 ? `${verb} process ${id}` : verb;
  }

  if (name === "browser") {
    const purpose = typeof args.purpose === "string" ? args.purpose.trim() : "";
    if (purpose.length > 0) return purpose;

    const url = typeof args.url === "string" ? args.url.trim() : "";
    const count = Array.isArray(args.actions) ? args.actions.length : 0;
    const steps = count > 0 ? ` (${count} step${count === 1 ? "" : "s"})` : "";

    if (url.length > 0) return `Open ${url}${steps}`;
    return count > 0 ? `Drive the page${steps}` : "Open a page";
  }

  return name;
}

/** `sed`'s window, so reading a 20k-line file does not fill the transcript. */
export function shellReadCommand(path: string, from: number, to: number): string {
  return `sed -n '${from},${to}p' ${shellQuote(path)}`;
}

export function shellListCommand(path: string): string {
  const root = path.length > 0 ? shellQuote(path) : ".";
  return [
    `find ${root} -path '*/node_modules' -prune -o -path '*/.git' -prune -o -type f -print`,
    "sort",
    `head -n ${CHAT_SHELL_LIST_MAX}`,
  ].join(" | ");
}

export function shellSearchCommand(query: string, path: string): string {
  const root = path.length > 0 ? shellQuote(path) : ".";
  return [
    `grep -rnIF --exclude-dir=node_modules --exclude-dir=.git -- ${shellQuote(query)} ${root}`,
    `head -n ${CHAT_SHELL_SEARCH_MAX}`,
  ].join(" | ");
}

/**
 * The id of one background process.
 *
 * The start time, not a counter: a persistent workspace keeps processes across
 * messages, so a counter that restarts at `p1` would collide with the log of
 * the process the previous message started.
 */
export function chatProcessId(now: number = Date.now()): string {
  return `p${Math.trunc(now)}`;
}

/** A process id, shaped by `chatProcessId` and nothing else. */
export function isChatProcessId(value: unknown): value is string {
  return typeof value === "string" && /^p[1-9][0-9]{0,14}$/.test(value);
}

export function chatProcessLogPath(id: string): string {
  return `${CHAT_PROCESS_DIR}/${id}.log`;
}

export function chatProcessPidPath(id: string): string {
  return `${CHAT_PROCESS_DIR}/${id}.pid`;
}

/**
 * Starts one command detached, with its output going to a file.
 *
 * `setsid` puts the command in its own process group, so stopping it stops
 * everything it spawns — a dev server's worker is part of the terminal it was
 * started from, not a leftover. The pid is written after the fork, so the next
 * call can find the group again; nothing here waits for the command, which is
 * what makes it background.
 */
export function startProcessCommand(command: string, id: string): string {
  return [
    `mkdir -p ${CHAT_PROCESS_DIR}`,
    `nohup setsid bash -c ${shellQuote(command)} > ${chatProcessLogPath(id)} 2>&1 &`,
    `echo $! > ${chatProcessPidPath(id)}`,
  ].join("\n");
}

export function readProcessCommand(id: string, lines: number): string {
  return `tail -n ${lines} ${chatProcessLogPath(id)} 2>/dev/null || echo "(no output yet)"`;
}

/**
 * Stops the process group, then removes the pid file.
 *
 * A server that ignores SIGTERM is why the SIGKILL is there: "stopped" has to
 * mean the port is free, not that a signal was delivered. Both are sent to the
 * group first and to the pid alone when the group is already gone.
 */
export function killProcessCommand(id: string): string {
  const pid = chatProcessPidPath(id);

  return [
    `if [ -f ${pid} ]; then`,
    `  p=$(cat ${pid})`,
    `  kill -TERM -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null`,
    `  sleep 0.2`,
    `  kill -KILL -"$p" 2>/dev/null || kill -KILL "$p" 2>/dev/null`,
    `  rm -f ${pid}`,
    `  echo "stopped ${id}"`,
    `else echo "no such process"`,
    `fi`,
  ].join("\n");
}

/** The line-numbered form of a read, so a citation from the sandbox is checkable. */
export function withLineNumbers(text: string, from: number): string {
  return text
    .split("\n")
    .map((line, index) => `${from + index}: ${line}`)
    .join("\n");
}
