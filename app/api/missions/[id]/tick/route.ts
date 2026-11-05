import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { runMissionTick } from "@/lib/execution/mission/loop";
import { readCommands, readMission } from "@/lib/execution/mission/store";
import { describeMission } from "@/lib/execution/mission/status";
import { readToken } from "@/lib/github/token";
import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * One tick, driven by the mission panel's poll.
 *
 * The authority to advance is the owner's session plus a same-origin check, not
 * a token in the URL: the worst a replayed tick can do is advance a mission the
 * caller already owns, and the row's `claimTick` makes two concurrent ticks
 * harmless.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
      { error: "Supabase is not configured." },
      { status: 503, headers: NO_STORE }
    );
  }

  const { id } = await params;
  const mission = await readMission(admin, id);

  if (!mission || mission.owner !== session.user.id) {
    return NextResponse.json({ error: "That mission no longer exists." }, { status: 404, headers: NO_STORE });
  }

  if (
    mission.status === "done" ||
    mission.status === "failed" ||
    mission.status === "timed_out" ||
    mission.status === "cancelled" ||
    mission.status === "stalled"
  ) {
    const commands = await readCommands(admin, mission.id);
    return NextResponse.json(
      { mission, commands, description: describeMission(mission, commands.length) },
      { headers: NO_STORE }
    );
  }

  let token: string | null = null;
  try {
    const github = await readToken(session.supabase, session.user.id);
    token = github?.token ?? null;
  } catch {
    token = null;
  }

  if (!token) {
    return NextResponse.json(
      { error: "Connect GitHub before continuing this mission." },
      { status: 400, headers: NO_STORE }
    );
  }

  const result = await runMissionTick({
    admin,
    supabase: session.supabase,
    owner: session.user.id,
    runId: mission.id,
    token,
    sealKey: serverEnv().githubTokenKey,
  });

  const fresh = (await readMission(admin, id)) ?? mission;
  const commands = await readCommands(admin, id);

  return NextResponse.json(
    {
      advanced: result.advanced,
      mission: fresh,
      commands,
      description: describeMission(fresh, commands.length),
    },
    { headers: NO_STORE }
  );
}
