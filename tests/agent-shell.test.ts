import { expect, test } from "bun:test";

import {
  CHAT_PROCESS_DIR,
  CHAT_SHELL_LIST_MAX,
  CHAT_SHELL_MAX_PROCESSES,
  CHAT_SHELL_SEARCH_MAX,
  chatProcessId,
  describeShellCall,
  isChatProcessId,
  isShellTool,
  killProcessCommand,
  readProcessCommand,
  shellListCommand,
  shellQuote,
  shellReadCommand,
  shellSearchCommand,
  startProcessCommand,
  withLineNumbers,
} from "../lib/agent/shell";

/**
 * The sandbox tools are the only place a model's words reach a shell, so the
 * quoting and the caps are asserted here rather than trusted to the prompt.
 */

test("the tools a chat turn offers include the sandbox browser", () => {
  expect(isShellTool("run_command")).toBe(true);
  expect(isShellTool("read_file")).toBe(true);
  expect(isShellTool("write_file")).toBe(true);
  expect(isShellTool("list_files")).toBe(true);
  expect(isShellTool("search_files")).toBe(true);
  expect(isShellTool("browser")).toBe(true);
  // A terminal is start, read and stop as well as one-shot commands.
  expect(isShellTool("start_process")).toBe(true);
  expect(isShellTool("read_process")).toBe(true);
  expect(isShellTool("kill_process")).toBe(true);
  // The mission loop's finish and the editor's proposal are not shell calls.
  expect(isShellTool("finish")).toBe(false);
  expect(isShellTool("propose_edits")).toBe(false);
});

test("a background process lives outside the repository and stops as a group", () => {
  const id = chatProcessId(1_700_000_000_000);

  expect(isChatProcessId(id)).toBe(true);
  // Anything that is not the shape start_process returns is refused before it
  // reaches a path, so an id can never walk out of the process directory.
  expect(isChatProcessId("../../etc/passwd")).toBe(false);
  expect(isChatProcessId("p0; rm -rf /")).toBe(false);

  const start = startProcessCommand("npm run dev", id);
  expect(start).toContain("setsid");
  expect(start).toContain("'npm run dev'");
  expect(start).toContain(`> ${CHAT_PROCESS_DIR}/${id}.log 2>&1`);
  expect(start).toContain(`echo $! > ${CHAT_PROCESS_DIR}/${id}.pid`);

  expect(readProcessCommand(id, 20)).toContain(`tail -n 20 ${CHAT_PROCESS_DIR}/${id}.log`);

  const kill = killProcessCommand(id);
  expect(kill).toContain(`-TERM -"$p"`);
  // A server that ignores TERM must still lose its port.
  expect(kill).toContain(`-KILL -"$p"`);
  expect(kill).toContain(`rm -f ${CHAT_PROCESS_DIR}/${id}.pid`);
  expect(CHAT_SHELL_MAX_PROCESSES).toBeGreaterThan(0);
});

test("the chat sandbox wires the process tools it advertises", async () => {
  const source = await Bun.file("lib/agent/sandbox.ts").text();

  expect(source).toContain('if (name === "start_process")');
  expect(source).toContain('if (name === "read_process")');
  expect(source).toContain('if (name === "kill_process")');
  expect(source).toContain("startProcessCommand(");
  expect(source).toContain("killProcessCommand(");
});

test("a path with a quote in it cannot become a second command", () => {
  const hostile = "src/a'; touch /tmp/pwned; '.ts";

  expect(shellQuote(hostile)).toBe(`'src/a'\\''; touch /tmp/pwned; '\\''.ts'`);
  expect(shellReadCommand(hostile, 1, 20)).toBe(
    `sed -n '1,20p' 'src/a'\\''; touch /tmp/pwned; '\\''.ts'`
  );
});

test("a search quotes the literal query and caps the result count", () => {
  const command = shellSearchCommand("drop table", "");

  expect(command).toContain("grep -rnIF");
  expect(command).toContain("'drop table'");
  expect(command).toContain(`head -n ${CHAT_SHELL_SEARCH_MAX}`);
  expect(command).toContain("--exclude-dir=node_modules");
});

test("a listing never walks node_modules or .git", () => {
  const command = shellListCommand("");

  expect(command).toContain("-path '*/node_modules' -prune");
  expect(command).toContain("-path '*/.git' -prune");
  expect(command).toContain(`head -n ${CHAT_SHELL_LIST_MAX}`);
  expect(CHAT_SHELL_LIST_MAX).toBeGreaterThan(0);
});

test("a step is described in the model's own words", () => {
  expect(
    describeShellCall("run_command", { purpose: "install dependencies", command: "bun install" })
  ).toBe("install dependencies");

  // Without a purpose the command itself is the honest label.
  expect(describeShellCall("run_command", { command: "bun test" })).toBe("bun test");
  expect(describeShellCall("read_file", { path: "lib/prompt.ts" })).toBe("Read lib/prompt.ts");
  expect(describeShellCall("write_file", { path: "src/a.ts" })).toBe("Write src/a.ts");
  expect(describeShellCall("search_files", { query: "TODO" })).toBe('Search for "TODO"');
  expect(describeShellCall("start_process", { purpose: "start the dev server" })).toBe(
    "start the dev server"
  );
  expect(describeShellCall("read_process", { id: "p1700000000000" })).toBe(
    "Read process p1700000000000"
  );
  expect(describeShellCall("kill_process", { id: "p1700000000000" })).toBe(
    "Stop process p1700000000000"
  );
});

test("a read is numbered from the line it started at", () => {
  const numbered = withLineNumbers("alpha\nbeta", 40);

  expect(numbered.split("\n")[0]).toBe("40: alpha");
  expect(numbered.split("\n")[1]).toBe("41: beta");
});
