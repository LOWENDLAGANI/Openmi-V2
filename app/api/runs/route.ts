import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { MAX_MESSAGE_CHARS } from "@/lib/chat-limits";
import { isSameOrigin } from "@/lib/http/origin";
import { firstAvailableModel, hasModel } from "@/lib/models";
import { modelCatalogue, providersConfigured } from "@/lib/providers";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  RUN_DAILY_RUNS,
  RUN_DAILY_TOKENS,
  RUN_MAX_CONCURRENT,
  checkRunQuota,
} from "@/lib/runs/limits";
import { createRun, listRuns, readQuota } from "@/lib/runs/store";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creating a run does no work.
 *
 * Authentication, authorization, quota and a queue row — that is the whole
 * request. The model call, the sandbox and the tools happen in the worker,
 * which is why this answers 202 in milliseconds and why closing the tab cannot
 * interrupt anything.
 */

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return json({ error: "That request came from another origin." }, 403);
  }

  const session = await getSession();

  if (session.state === "unconfigured") {
    return json({ error: "Supabase is not configured on this deployment." }, 503);
  }

  if (session.state !== "signed-in") return json({ error: "Sign in to run the agent." }, 401);

  const limited = await checkRateLimit(supabaseAdmin(), "run", session.user.id);

  if (!limited.allowed) {
    return json(
      {
        error: `Too many runs started. Try again in ${limited.retryAfterSeconds} seconds.`,
        code: "rate-limited",
      },
      429
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { prompt?: unknown; chatId?: unknown; model?: unknown }
    | null;

  if (!body) return json({ error: "Malformed request." }, 400);

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

  if (prompt.length === 0) return json({ error: "Write something first." }, 400);
  if (prompt.length > MAX_MESSAGE_CHARS) {
    return json(
      { error: `A run's prompt is capped at ${MAX_MESSAGE_CHARS.toLocaleString()} characters.` },
      413
    );
  }

  if (!providersConfigured()) {
    return json(
      { error: "No model provider is configured, so a run cannot start.", code: "no-provider" },
      409
    );
  }

  const admin = supabaseAdmin();

  if (!admin) {
    return json(
      { error: "This deployment has no service role key, so runs cannot be queued." },
      503
    );
  }

  const chatId =
    typeof body.chatId === "string" && body.chatId.length > 0 ? body.chatId : null;

  let repo: string | null = null;
  let baseSha: string | null = null;

  if (chatId) {
    // Read through the reader's own client: RLS decides whether this chat is
    // theirs, and a chat id from the request body is never trusted.
    const { data: chat } = await session.supabase
      .from("chats")
      .select("id, repo_full_name, repo_base_sha")
      .eq("id", chatId)
      .maybeSingle();

    if (!chat) return json({ error: "That chat does not exist." }, 404);

    const row = chat as { repo_full_name?: string | null; repo_base_sha?: string | null };
    repo = row.repo_full_name ?? null;
    baseSha = row.repo_base_sha ?? null;
  }

  const catalogue = modelCatalogue();
  const model = hasModel(catalogue, body.model)
    ? (body.model as string)
    : firstAvailableModel(catalogue);

  // Quota is checked before the row exists, so a refusal costs nothing and
  // leaves nothing behind. The unique index on live runs is the second guard:
  // two requests racing here cannot both win.
  const quota = await readQuota(admin, session.user.id);
  const decision = checkRunQuota(quota);

  if (!decision.allowed) {
    return json(
      { error: decision.message, code: decision.code, quota },
      decision.code === "concurrency" ? 409 : 402
    );
  }

  const runId = randomUUID();

  try {
    const run = await createRun(admin, {
      id: runId,
      owner: session.user.id,
      chatId,
      repo,
      baseSha,
      prompt,
      model,
    });

    return json(
      {
        runId: run.id,
        status: run.status,
        model: run.model,
        quota: { ...quota, active: quota.active + 1 },
        limits: {
          concurrent: RUN_MAX_CONCURRENT,
          dailyRuns: RUN_DAILY_RUNS,
          dailyTokens: RUN_DAILY_TOKENS,
        },
      },
      202
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "The run could not be queued.";

    // The one-active-run index is the authority when two requests race.
    if (/duplicate key|unique/i.test(message)) {
      return json(
        {
          error: "You already have a run in progress. Wait for it to finish, or cancel it first.",
          code: "concurrency",
        },
        409
      );
    }

    return json({ error: message }, 500);
  }
}

export async function GET() {
  const session = await getSession();

  if (session.state !== "signed-in") return json({ error: "Sign in." }, 401);

  const runs = await listRuns(session.supabase, 20);
  const admin = supabaseAdmin();
  const quota = admin
    ? await readQuota(admin, session.user.id)
    : { active: 0, runsToday: 0, tokensToday: 0 };

  return json(
    {
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status,
        stopReason: run.stop_reason,
        model: run.model,
        prompt: run.prompt.slice(0, 160),
        steps: run.steps,
        inputTokens: run.input_tokens,
        outputTokens: run.output_tokens,
        costUsd: run.cost_usd,
        createdAt: run.created_at,
        endedAt: run.ended_at,
      })),
      quota,
      limits: {
        concurrent: RUN_MAX_CONCURRENT,
        dailyRuns: RUN_DAILY_RUNS,
        dailyTokens: RUN_DAILY_TOKENS,
      },
    },
    200
  );
}
