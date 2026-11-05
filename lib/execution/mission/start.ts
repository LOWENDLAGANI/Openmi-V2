import "server-only";

import { randomUUID } from "node:crypto";

import { reserveExecutionDew } from "@/lib/dew/store";
import { clearStaleRuns } from "@/lib/execution/store";
import type { supabaseAdmin } from "@/lib/supabase/admin";
import type { supabaseServer } from "@/lib/supabase/server";

import {
  missionCaps,
  missionReserveDew,
  type MissionAutonomy,
} from "./budget";
import { createMissionRun } from "./store";

/**
 * Starting a mission: prove the account may run one, take the reservation, and
 * record the row. No sandbox is created here — the first tick provisions it, so
 * the POST returns with an id the browser can poll instead of holding a request
 * open for a clone and an install.
 */

type SessionClient = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;
type AdminClient = NonNullable<ReturnType<typeof supabaseAdmin>>;

export type MissionContext = {
  runId: string;
  owner: string;
  chatId: string;
  goal: string;
  autonomy: MissionAutonomy;
  minutes: number;
  repo: string;
  baseSha: string;
  model: string;
};

export type StartMissionResult =
  | { ok: true; mission: MissionContext; reservedDew: number }
  | { ok: false; status: number; code: string; message: string };

export function readAutonomy(value: unknown): MissionAutonomy | null {
  return value === "plan" || value === "act" || value === "ship" ? value : null;
}

export async function startMission(input: {
  supabase: SessionClient;
  admin: AdminClient;
  owner: string;
  chatId: string;
  goal: string;
  autonomy: MissionAutonomy;
  minutes: number;
}): Promise<StartMissionResult> {
  const { supabase, admin, owner, chatId, goal, autonomy } = input;

  const caps = missionCaps();
  const minutes = Math.min(caps.minutes, Math.max(1, Math.trunc(input.minutes)));
  const startedAt = Date.now();

  const { data: chatRow, error: chatError } = await supabase
    .from("chats")
    .select("id, repo_full_name, repo_base_sha, model")
    .eq("id", chatId)
    .maybeSingle();

  if (chatError) {
    return { ok: false, status: 400, code: "refused", message: chatError.message };
  }

  const chat = chatRow as
    | { id: string; repo_full_name: string | null; repo_base_sha: string | null; model: string | null }
    | null;

  if (!chat) {
    return {
      ok: false,
      status: 404,
      code: "chat_not_found",
      message: "That chat no longer exists.",
    };
  }

  if (!chat.repo_full_name || !chat.repo_base_sha) {
    return {
      ok: false,
      status: 409,
      code: "no_repository",
      message: "Attach a repository before giving the agent a goal to work on.",
    };
  }

  // One live mission per account. Clearing a crashed row first is what keeps a
  // dead process from locking the account out forever.
  await clearStaleRuns(admin, owner);

  const runId = randomUUID();
  const reservedDew = missionReserveDew(minutes);

  const reserved = await reserveExecutionDew(admin, owner, runId, reservedDew);

  if (!reserved.ok) {
    return {
      ok: false,
      status: 402,
      code: "insufficient_dew",
      message: reserved.error.includes("insufficient balance")
        ? `A mission reserves ${reservedDew} Dew before the sandbox starts, and the balance cannot cover that. Top up with a code, or wait for the daily refill.`
        : `Dew could not be reserved, so nothing was started: ${reserved.error}`,
    };
  }

  try {
    await createMissionRun(admin, {
      id: runId,
      owner,
      chatId,
      goal,
      autonomy,
      model: chat.model ?? "auto",
      repo: chat.repo_full_name,
      baseSha: chat.repo_base_sha,
      minutes,
      startedAt,
    });
  } catch (caught) {
    // The reservation exists but the mission does not, so give it straight back.
    const { settleExecutionDew } = await import("@/lib/dew/store");
    await settleExecutionDew(admin, owner, runId, 0);

    const message = caught instanceof Error ? caught.message : "The mission could not be recorded.";

    return {
      ok: false,
      status: /one_active|duplicate key|unique/i.test(message) ? 409 : 400,
      code: "refused",
      message: /one_active|duplicate key|unique/i.test(message)
        ? "A mission is already running on this account. Stop it before starting another."
        : message,
    };
  }

  return {
    ok: true,
    reservedDew,
    mission: {
      runId,
      owner,
      chatId,
      goal,
      autonomy,
      minutes,
      repo: chat.repo_full_name,
      baseSha: chat.repo_base_sha,
      model: chat.model ?? "auto",
    },
  };
}
