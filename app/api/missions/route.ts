import { NextResponse, after } from "next/server";

import { serverEnv, missionModeEnabled } from "@/lib/env";
import { runMissionTick } from "@/lib/execution/mission/loop";
import { readCommands, readLatestMission } from "@/lib/execution/mission/store";
import { describeMission } from "@/lib/execution/mission/status";
import { missionCaps } from "@/lib/execution/mission/budget";
import { readAutonomy, startMission } from "@/lib/execution/mission/start";
import { readToken } from "@/lib/github/token";
import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Starting and reading missions.
 *
 * POST records the mission and returns its id; provisioning and the first tick
 * run after the response, so the browser polls a row instead of holding a
 * request open for a clone. GET returns the row, its command ledger and the
 * sentence that row supports.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" } as const;
const MAX_GOAL_CHARS = 4_000;

export async function GET(request: Request) {
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json(
      { configured: false, mission: null, commands: [], error: "Sign in first." },
      { status: 401, headers: NO_STORE }
    );
  }

  const chatId = new URL(request.url).searchParams.get("chatId") ?? "";

  if (chatId.length === 0) {
    return NextResponse.json(
      { configured: false, mission: null, commands: [], error: "chatId is required." },
      { status: 400, headers: NO_STORE }
    );
  }

  const admin = supabaseAdmin();

  if (!admin) {
    return NextResponse.json(
      { configured: false, mission: null, commands: [], error: "Supabase is not configured." },
      { status: 503, headers: NO_STORE }
    );
  }

  const mission = await readLatestMission(admin, session.user.id, chatId);
  const commands = mission ? await readCommands(admin, mission.id) : [];

  return NextResponse.json(
    {
      configured: missionModeEnabled(),
      mission,
      commands,
      description: describeMission(mission, commands.length),
      caps: missionCaps(),
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "That request came from another origin." },
      { status: 403, headers: NO_STORE }
    );
  }

  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  }

  const admin = supabaseAdmin();

  if (!admin) {
    return NextResponse.json(
      { error: "Supabase is not configured, so a mission cannot be recorded." },
      { status: 503, headers: NO_STORE }
    );
  }

  if (!missionModeEnabled()) {
    return NextResponse.json(
      {
        error:
          "Missions are not enabled on this deployment. Set MISSION_MODE_ENABLED=on and DAYTONA_API_KEY to turn them on.",
      },
      { status: 503, headers: NO_STORE }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { chatId?: unknown; goal?: unknown; autonomy?: unknown; minutes?: unknown }
    | null;

  const chatId = body && typeof body.chatId === "string" ? body.chatId.trim() : "";
  const goal = body && typeof body.goal === "string" ? body.goal.trim() : "";
  const autonomy = readAutonomy(body?.autonomy);

  if (chatId.length === 0) {
    return NextResponse.json({ error: "chatId is required." }, { status: 400, headers: NO_STORE });
  }

  if (goal.length < 3 || goal.length > MAX_GOAL_CHARS) {
    return NextResponse.json(
      { error: `Describe the goal in 3 to ${MAX_GOAL_CHARS} characters.` },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!autonomy) {
    return NextResponse.json(
      { error: "autonomy must be plan, act or ship." },
      { status: 400, headers: NO_STORE }
    );
  }

  let token: string | null = null;
  try {
    const github = await readToken(session.supabase, session.user.id);
    token = github?.token ?? null;
  } catch (caught) {
    return NextResponse.json(
      {
        error:
          caught instanceof Error ? caught.message : "The GitHub token could not be opened.",
      },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: "Connect GitHub before giving the agent a repository to work in." },
      { status: 400, headers: NO_STORE }
    );
  }

  const minutes = typeof body?.minutes === "number" ? body.minutes : missionCaps().minutes;

  const started = await startMission({
    supabase: session.supabase,
    admin,
    owner: session.user.id,
    chatId,
    goal,
    autonomy,
    minutes,
  });

  if (!started.ok) {
    return NextResponse.json(
      { error: started.message, code: started.code },
      { status: started.status, headers: NO_STORE }
    );
  }

  const owner = session.user.id;
  const runId = started.mission.runId;
  const githubToken = token;
  const sealKey = serverEnv().githubTokenKey;

  after(async () => {
    await runMissionTick({
      admin,
      supabase: session.supabase,
      owner,
      runId,
      token: githubToken,
      sealKey,
    });
  });

  return NextResponse.json(
    { missionId: runId, reservedDew: started.reservedDew },
    { status: 202, headers: NO_STORE }
  );
}
