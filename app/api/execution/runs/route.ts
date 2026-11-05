import { NextResponse, after } from "next/server";

import { serverEnv } from "@/lib/env";
import { executionConfigured } from "@/lib/execution/provider";
import { executeRun, startExecutionRun } from "@/lib/execution/run";
import { readEvents, readRunForChangeset } from "@/lib/execution/store";
import { describeRun } from "@/lib/execution/status";
import { readToken } from "@/lib/github/token";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Starting a run, and reading one.
 *
 * POST records the run and returns its id, then the work happens after the
 * response (`after`), so the browser polls a row instead of holding a request
 * open for a build. GET is the poll: one run row, its events, and the sentence
 * that row supports.
 *
 * Nothing here is cached. A run is an observation of a moment, and a stale one
 * is worse than none.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(request: Request) {
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json(
      { configured: false, run: null, events: [], error: "Sign in first." },
      { status: 401, headers: NO_STORE }
    );
  }

  const changesetId = new URL(request.url).searchParams.get("changesetId") ?? "";
  if (changesetId.length === 0) {
    return NextResponse.json(
      { configured: false, run: null, events: [], error: "changesetId is required." },
      { status: 400, headers: NO_STORE }
    );
  }

  const run = await readRunForChangeset(session.supabase, changesetId);
  const events = run ? await readEvents(session.supabase, run.id) : [];

  return NextResponse.json(
    {
      configured: executionConfigured(),
      run,
      events,
      description: describeRun(run),
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: Request) {
  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json(
      { error: "Sign in first." },
      { status: 401, headers: NO_STORE }
    );
  }

  const admin = supabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase is not configured, so a run cannot be recorded." },
      { status: 503, headers: NO_STORE }
    );
  }

  if (!executionConfigured()) {
    return NextResponse.json(
      {
        error:
          "Execution is not configured on this deployment. Set DAYTONA_API_KEY to enable it.",
      },
      { status: 503, headers: NO_STORE }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { changesetId?: unknown }
    | null;

  const changesetId =
    body && typeof body.changesetId === "string" ? body.changesetId.trim() : "";

  if (changesetId.length === 0) {
    return NextResponse.json(
      { error: "changesetId is required." },
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
          caught instanceof Error
            ? caught.message
            : "The GitHub token could not be opened.",
      },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: "Connect GitHub before verifying a changeset." },
      { status: 400, headers: NO_STORE }
    );
  }

  const started = await startExecutionRun({
    supabase: session.supabase,
    admin,
    owner: session.user.id,
    changesetId,
  });

  if (!started.ok) {
    return NextResponse.json(
      { error: started.message, code: started.code },
      { status: started.status, headers: NO_STORE }
    );
  }

  const { runId, context } = started;
  const owner = session.user.id;
  const githubToken = token;

  // Verification is the default, not a mode. The run repairs a failing build,
  // and the approval that follows is gated on a real exit 0 inside
  // `executeRun`, so nothing is written to GitHub unless the build passes.
  after(async () => {
    await executeRun({
      admin,
      supabase: session.supabase,
      owner,
      runId,
      token: githubToken,
      context,
      repair: true,
      autoApprove: true,
      sealKey: serverEnv().githubTokenKey,
    });
  });

  return NextResponse.json({ runId }, { status: 202, headers: NO_STORE });
}
