import { expect, test } from "bun:test";

import {
  CHAT_SHELL_LIST_MAX,
  CHAT_SHELL_SEARCH_MAX,
  describeShellCall,
  isShellTool,
  shellListCommand,
  shellQuote,
  shellReadCommand,
  shellSearchCommand,
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
  // The mission loop's process and finish tools are not part of a chat turn.
  expect(isShellTool("start_process")).toBe(false);
  expect(isShellTool("finish")).toBe(false);
  expect(isShellTool("propose_edits")).toBe(false);
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
});

test("a read is numbered from the line it started at", () => {
  const numbered = withLineNumbers("alpha\nbeta", 40);

  expect(numbered.split("\n")[0]).toBe("40: alpha");
  expect(numbered.split("\n")[1]).toBe("41: beta");
});
