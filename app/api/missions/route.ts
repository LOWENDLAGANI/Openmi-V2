import { NextResponse, after } from "next/server";

import { executionConfigured, serverEnv } from "@/lib/env";
import { settleExecutionDew, startDewSession, type ChargeMode } from "@/lib/dew/store";
import { runMissionTick } from "@/lib/execution/mission/loop";
import {
  readCommands,
  readLatestMission,
  updateMission,
} from "@/lib/execution/mission/store";
import { describeMission } from "@/lib/execution/mission/status";
import { missionCaps } from "@/lib/execution/mission/budget";
import { readAutonomy, startMission } from "@/lib/execution/mission/start";
import { isCommitSha, isRepoFullName } from "@/lib/github/read";
import { readToken } from "@/lib/github/token";
import { isSameOrigin } from "@/lib/http/origin";
import { appendMessage } from "@/lib/messages";
import { DEFAULT_MODEL, hasModel } from "@/lib/models";
import { modelCatalogue } from "@/lib/providers";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Starting and reading missions.
 *
 * A mission is not a mode: it is how a chat with a repository answers. The
 * composer sends the goal here, the row is recorded, and the first tick runs
 * after the response so the browser polls a row instead of holding a request
 * open for a clone. The goal is stored as the chat's user message, so the
 * transcript still reads as a conversation about the work.
 *
 * The message is charged the way the chat prices itself — an hour or one
 * request, recorded on the chat row — because the model calls inside the
 * mission cost the same provider credits.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" } as const;
const MAX_GOAL_CHARS = 4_000;
const LIVE = ["queued", "running", "paused"];

type ChatRow = {
  id: string;
  repo_full_name: string | null;
  repo_branch: string | null;
  repo_base_sha: string | null;
  model: string | null;
  charge_mode: string | null;
};

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
      configured: executionConfigured(),
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

  if (!executionConfigured()) {
    return NextResponse.json(
      {
        error:
          "The sandbox is not configured on this deployment. Set DAYTONA_API_KEY to give the agent an environment.",
      },
      { status: 503, headers: NO_STORE }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        chatId?: unknown;
        goal?: unknown;
        autonomy?: unknown;
        minutes?: unknown;
        mode?: unknown;
        repo?: unknown;
        branch?: unknown;
        sha?: unknown;
      }
    | null;

  const askedChatId = body && typeof body.chatId === "string" ? body.chatId.trim() : "";
  const goal = body && typeof body.goal === "string" ? body.goal.trim() : "";
  const autonomy = readAutonomy(body?.autonomy);
  const requestedMode: ChargeMode = body?.mode === "request" ? "request" : "hour";

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

  // A chat that does not exist yet is the first message of a conversation. The
  // repository comes from the pinned draft, the same way the chat route pins it,
  // so the first goal is already a mission instead of an exception to one.
  let chatId = askedChatId;

  if (chatId.length === 0) {
    const repo = body && typeof body.repo === "string" ? body.repo.trim() : "";
    const branch = body && typeof body.branch === "string" ? body.branch.trim() : "";
    const sha = body && typeof body.sha === "string" ? body.sha.trim() : "";

    if (!isRepoFullName(repo) || sha.length === 0 || !isCommitSha(sha)) {
      return NextResponse.json(
        {
          error:
            "Attach a repository to this chat before giving the agent a goal, or send the repository and commit with the goal.",
        },
        { status: 400, headers: NO_STORE }
      );
    }

    const { data: created, error: createError } = await session.supabase
      .from("chats")
      .insert({
        owner: session.user.id,
        title: goal.slice(0, 80),
        charge_mode: requestedMode,
        repo_full_name: repo,
        repo_branch: branch,
        repo_base_sha: sha,
      })
      .select("id")
      .single();

    if (createError || !created) {
      return NextResponse.json(
        { error: createError?.message ?? "Could not start a chat for this mission." },
        { status: 500, headers: NO_STORE }
      );
    }

    chatId = (created as { id: string }).id;
  }

  const { data: row, error: chatError } = await session.supabase
    .from("chats")
    .select("id, repo_full_name, repo_branch, repo_base_sha, model, charge_mode")
    .eq("id", chatId)
    .maybeSingle();

  if (chatError) {
    return NextResponse.json({ error: chatError.message }, { status: 500, headers: NO_STORE });
  }

  const chat = row as ChatRow | null;

  if (!chat) {
    return NextResponse.json({ error: "That chat does not exist." }, { status: 404, headers: NO_STORE });
  }

  if (!chat.repo_full_name || !chat.repo_base_sha) {
    return NextResponse.json(
      {
        error: "Attach a repository before giving the agent a goal to work on.",
        chatId,
      },
      { status: 409, headers: NO_STORE }
    );
  }

  const model = hasModel(modelCatalogue(), chat.model) ? chat.model ?? DEFAULT_MODEL : DEFAULT_MODEL;

  // One live mission per chat, checked before the charge so a double click does
  // not cost an hour for a refusal the database was always going to make.
  const latest = await readLatestMission(admin, session.user.id, chatId);

  if (latest && LIVE.includes(latest.status)) {
    return NextResponse.json(
      {
        error: "A mission is already running in this chat. Stop it before starting another.",
        code: "mission_active",
        chatId,
      },
      { status: 409, headers: NO_STORE }
    );
  }

  const minutes = typeof body?.minutes === "number" ? body.minutes : missionCaps().minutes;

  // The reservation comes first: it is the cheap, refundable gate that also
  // enforces one live mission per account. Charging an hour before this would
  // let a refused mission cost an hour for nothing.
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
      { error: started.message, code: started.code, chatId },
      { status: started.status, headers: NO_STORE }
    );
  }

  const mode: ChargeMode =
    requestedMode === "request" || chat.charge_mode === "request" ? "request" : "hour";

  const dew = await startDewSession(session.supabase, model, chat.repo_full_name, {
    chatId,
    mode,
  });

  if (!dew.ok) {
    // The goal could not be paid for, so nothing runs: give the reservation
    // back and cancel the row rather than leave a mission nobody funded.
    await settleExecutionDew(admin, session.user.id, started.mission.runId, 0);
    await updateMission(
      admin,
      started.mission.runId,
      {
        status: "cancelled",
        ended_at: new Date().toISOString(),
        failure_code: null,
        failure_detail: "The goal could not be charged, so nothing ran.",
        charged_dew: 0,
      },
      { onlyWhileLive: true }
    );

    return NextResponse.json(
      {
        error: dew.error,
        code: dew.code,
        activeChatId: dew.activeChatId,
        chatId,
      },
      { status: dew.code === "hour-active" ? 409 : 402, headers: NO_STORE }
    );
  }

  // The goal is a message in the conversation, not a hidden request: the
  // transcript and the mission ledger describe the same thing.
  await appendMessage(session.supabase, chatId, "user", goal, model);

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
    { missionId: runId, chatId, reservedDew: started.reservedDew, charged: dew.session.price, mode },
    { status: 202, headers: NO_STORE }
  );
}
