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
] as const;

export type ChatShellToolName = (typeof CHAT_SHELL_TOOL_NAMES)[number];

/** Commands one message may run. A chat turn is a question, not a build farm. */
export const CHAT_SHELL_MAX_COMMANDS = 40;

/** Wall clock the sandbox may consume inside one turn. */
export const CHAT_SHELL_BUDGET_MS = 200_000;

/** One command's ceiling, inside the turn's own budget. */
export const CHAT_SHELL_COMMAND_MS = 120_000;

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

/** The line-numbered form of a read, so a citation from the sandbox is checkable. */
export function withLineNumbers(text: string, from: number): string {
  return text
    .split("\n")
    .map((line, index) => `${from + index}: ${line}`)
    .join("\n");
}
