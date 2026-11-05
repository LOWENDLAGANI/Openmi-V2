import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("missions are the default, not a mode", () => {
  test("the second switch is gone from the deployment surface", () => {
    expect(read("lib/env.ts")).not.toContain("MISSION_MODE_ENABLED");
    expect(read(".env.example")).not.toContain("MISSION_MODE_ENABLED");
  });

  test("the mission routes follow the sandbox key, not a flag", () => {
    const route = read("app/api/missions/route.ts");

    expect(route).toContain("executionConfigured()");
    expect(route).not.toContain("missionModeEnabled");
  });

  test("a goal in a repo chat goes to the mission API, not a chat turn", () => {
    const panel = read("components/ChatPanel.tsx");

    expect(panel).toContain("missionDefault && repo");
    expect(panel).toContain('fetch("/api/missions"');
    expect(panel).toContain("openmi:mission-started");
  });

  test("the first message of a repo chat is a mission too", () => {
    const route = read("app/api/missions/route.ts");

    // A draft has no chat yet, so the route creates one from the pinned repo
    // instead of failing the first goal.
    expect(route).toContain('.from("chats")');
    expect(route).toContain("repo_base_sha: sha");
    expect(route).toContain(
      'appendMessage(session.supabase, chatId, "user", goal, model)'
    );
  });

  test("a refused charge gives the reservation back instead of keeping it", () => {
    const route = read("app/api/missions/route.ts");
    const reserve = route.indexOf("startMission({");
    const charge = route.indexOf("startDewSession(");
    const refund = route.indexOf("settleExecutionDew(admin, session.user.id, started.mission.runId, 0)");

    expect(reserve).toBeGreaterThan(-1);
    expect(charge).toBeGreaterThan(reserve);
    expect(refund).toBeGreaterThan(charge);
    expect(route).toContain('status: "cancelled"');
  });

  test("a double click does not cost an hour for a refusal", () => {
    const route = read("app/api/missions/route.ts");

    expect(route.indexOf("readLatestMission(admin")).toBeLessThan(
      route.indexOf("startDewSession(")
    );
  });

  test("the console hears about a mission the composer started", () => {
    expect(read("components/MissionPanel.tsx")).toContain("openmi:mission-started");
  });

  test("both composers get the default once the sandbox exists", () => {
    const page = read("app/chat/page.tsx");

    expect(page).toContain("missionDefault={executionConfigured()}");
    expect(page).toContain("missionDefault={executionConfigured() && repo !== null}");
  });
});
