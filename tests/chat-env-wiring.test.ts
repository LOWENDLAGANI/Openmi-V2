import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The turn-side contract for chat environments.
 *
 * The resolver is tested directly; what these assert is that the turn hands the
 * owner and the chat to the run, that a continuation is the same run's next
 * window, and that the run opens the chat's own workspace before it would ever
 * create a new box.
 */

const route = readFileSync("app/api/chat/route.ts", "utf8");

function at(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle);
  expect(index).toBeGreaterThan(-1);
  return index;
}

test("the route hands the owner and the chat to the run, and can reattach to it", () => {
  expect(route).toContain("owner: session.user.id");
  expect(route).toContain("chatId,");

  // A continuation is the same run's next window, not a second turn: the run is
  // read by id and checked against this owner and this chat before streaming.
  expect(route).toContain("continuationId");
  expect(route).toContain("run.owner !== session.user.id");
  expect(route).toContain("run.chat_id !== chatId");

  // The in-request shell lease is gone with the loop that held it.
  expect(route).not.toContain("createShellTurn");
  expect(route).not.toContain("onNotice:");
});

test("a run reuses its chat's workspace instead of creating a new box", () => {
  const runSandbox = readFileSync("lib/runs/sandbox.ts", "utf8");
  const loop = readFileSync("lib/runs/loop.ts", "utf8");

  // The chat's box is opened before any provider create, so a chat turn never
  // pays for a second filesystem, and the kill switch is honoured.
  expect(at(runSandbox, "openChatWorkspace(")).toBeLessThan(
    at(runSandbox, "createProviderSandbox(")
  );
  expect(runSandbox).toContain("chatSandboxesEnabled");
  expect(runSandbox).toContain("releaseChatSandbox");

  // The run tools keep one root: `work` is linked at the chat's directory.
  expect(runSandbox).toContain("MISSION_WORKDIR");

  // The loop gives the workspace back the way it was lent: released for a
  // chat's box, paused only for a run's own.
  expect(loop).toContain("releaseWorkspace");
  expect(loop).toContain("pauseRunWorkspace");
  expect(loop).toContain("shared");
});
