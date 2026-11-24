import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { readAdminAccess } from "@/lib/admin/access";
import { MAX_MESSAGE_CHARS } from "@/lib/chat-limits";
import { readCreditProfile } from "@/lib/credits/store";
import { pullChatBranch } from "@/lib/execution/sync/session";
import { readToken } from "@/lib/github/token";
import { isSameOrigin } from "@/lib/http/origin";
import {
  adminOnlyRefusal,
  firstAvailableModel,
  hasModel,
  modelRequiresAdmin,
  modelRequiresPaid,
  paidOnlyRefusal,
} from "@/lib/models";
import { modelCatalogue, providersConfigured } from "@/lib/providers";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  RUN_DAILY_RUNS,
  RUN_DAILY_TOKENS,
  RUN_MAX_CONCURRENT,
  checkRunQuota,
} from "@/lib/runs/limits";
import {
  createRun,
  listRuns,
  readQuota,
  readUnlimitedRuns,
  settleStalledRuns,
} from "@/lib/runs/store";
import { wakeWorker } from "@/lib/runs/wake";
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
      .select("id, repo_full_name, repo_branch, repo_base_sha")
      .eq("id", chatId)
      .maybeSingle();

    if (!chat) return json({ error: "That chat does not exist." }, 404);

    const row = chat as {
      repo_full_name?: string | null;
      repo_branch?: string | null;
      repo_base_sha?: string | null;
    };
    repo = row.repo_full_name ?? null;
    baseSha = row.repo_base_sha ?? null;

    if (repo && row.repo_branch) {
      try {
        const github = await readToken(session.supabase, session.user.id);
        if (github) {
          const pulled = await pullChatBranch({
            admin,
            supabase: session.supabase,
            chatId,
            token: github.token,
          });
          if (pulled.ok && pulled.verdict === "pull") {
            baseSha = pulled.head;
          }
        }
      } catch {
        // Best-effort sync; proceed with the existing pinned sha.
      }
    }
  }

  const catalogue = modelCatalogue();
  const model = hasModel(catalogue, body.model)
    ? (body.model as string)
    : firstAvailableModel(catalogue);

  // A run is a second way into the same models, so the paid-only check lives
  // here too rather than only on the chat route.
  if (modelRequiresPaid(model, catalogue)) {
    const profile = await readCreditProfile(session.supabase, session.user.id);
    const refusal = paidOnlyRefusal(model, profile?.paidActive === true, catalogue);

    if (refusal) return json(refusal, 402);
  }

  // The operator-only model is refused here as well as in the chat route: a run
  // is a second way into the same models.
  if (modelRequiresAdmin(model, catalogue)) {
    const access = await readAdminAccess();
    const refusal = adminOnlyRefusal(model, access.state === "admin", catalogue);

    if (refusal) return json(refusal, 403);
  }

  // A leftover row from a dead worker would hold the one-live-run index and
  // refuse this account forever, so settle its stalls before reading the quota.
  await settleStalledRuns(admin, session.user.id);

  // Quota is checked before the row exists, so a refusal costs nothing and
  // leaves nothing behind. The unique index on live runs is the second guard:
  // two requests racing here cannot both win.
  const quota = await readQuota(admin, session.user.id);

  // Admins skip the daily budgets, and so does an account an admin granted
  // unlimited from the panel. Concurrency is still checked for both.
  const unlimited =
    (await readUnlimitedRuns(admin, session.user.id)) ||
    (await readAdminAccess(session)).state === "admin";
  const decision = checkRunQuota({ ...quota, unlimited });

  if (!decision.allowed) {
    return json(
      { error: decision.message, code: decision.code, quota },
      decision.code === "concurrency" ? 409 : 402
    );
  }

  const runId = randomUUID();

  const queueRun = () =>
    createRun(admin, {
      id: runId,
      owner: session.user.id,
      chatId,
      repo,
      baseSha,
      prompt,
      model,
    });

  let run: Awaited<ReturnType<typeof queueRun>>;

  try {
    run = await queueRun();

    // A worker that sleeps without traffic is woken by this one request, so the
    // row is claimed without a reader opening the health URL by hand.
    wakeWorker();

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
          unlimited,
        },
      },
      202
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "The run could not be queued.";

    // The one-active-run index is the authority when two requests race. A
    // second settlement distinguishes a leftover row from a live run.
    if (/duplicate key|unique/i.test(message)) {
      await settleStalledRuns(admin, session.user.id);

      try {
        run = await queueRun();
      } catch (retry) {
        const again =
          retry instanceof Error ? retry.message : "The run could not be queued.";

        if (!/duplicate key|unique/i.test(again)) {
          return json({ error: again }, 500);
        }

        return json(
          {
            error:
              "You already have a run in progress. Wait for it to finish, or cancel it first.",
            code: "concurrency",
          },
          409
        );
      }

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
            unlimited,
          },
        },
        202
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
  const unlimited =
    (admin ? await readUnlimitedRuns(admin, session.user.id) : false) ||
    (await readAdminAccess(session)).state === "admin";

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
        unlimited,
      },
    },
    200
  );
}
