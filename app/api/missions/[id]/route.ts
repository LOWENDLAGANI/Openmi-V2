import { NextResponse } from "next/server";

import { settleExecutionDew } from "@/lib/dew/store";
import { chargeMissionDuration } from "@/lib/execution/mission/budget";
import {
  destroySandbox,
  readCommands,
  readMission,
  updateMission,
} from "@/lib/execution/mission/store";
import { describeMission, isMissionTerminal } from "@/lib/execution/mission/status";
import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Reading one mission, and stopping it.
 *
 * Cancelling settles immediately with the same rule the runner uses: minutes
 * are charged only once a sandbox existed. The runner's own settlement is
 * idempotent, so whichever call lands second changes nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    return NextResponse.json(
      { error: "That mission no longer exists." },
      { status: 404, headers: NO_STORE }
    );
  }

  const commands = await readCommands(admin, id);

  return NextResponse.json(
    { mission, commands, description: describeMission(mission, commands.length) },
    { headers: NO_STORE }
  );
}

export async function DELETE(
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
    return NextResponse.json(
      { error: "That mission no longer exists." },
      { status: 404, headers: NO_STORE }
    );
  }

  if (isMissionTerminal(mission.status)) {
    return NextResponse.json(
      { cancelled: false, status: mission.status },
      { headers: NO_STORE }
    );
  }

  const elapsed = Math.max(0, Date.now() - new Date(mission.started_at).getTime());
  const minutes = Math.max(
    1,
    Math.round(
      (new Date(mission.deadline_at ?? Date.now()).getTime() -
        new Date(mission.started_at).getTime()) /
        60_000
    )
  );

  const charged = mission.sandbox_id
    ? chargeMissionDuration(elapsed, minutes)
    : 0;

  const settlement = await settleExecutionDew(admin, session.user.id, id, charged);
  const settledDew = settlement.ok ? charged : 0;

  await updateMission(
    admin,
    id,
    {
      status: "cancelled",
      ended_at: new Date().toISOString(),
      failure_code: null,
      failure_detail: null,
      charged_dew: settledDew,
    },
    { onlyWhileLive: true }
  );

  await destroySandbox(mission.sandbox_id);

  return NextResponse.json(
    { cancelled: true, chargedDew: settledDew },
    { headers: NO_STORE }
  );
}
