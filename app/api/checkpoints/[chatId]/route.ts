import { NextResponse } from "next/server";

import { checkpointsEnabled } from "@/lib/execution/checkpoints/plan";
import {
  restoreCheckpoint,
  saveCheckpoint,
} from "@/lib/execution/checkpoints/session";
import { listCheckpoints } from "@/lib/execution/checkpoints/store";
import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * A chat's versions.
 *
 * GET lists what the workspace has committed; POST saves one or restores one.
 * The chat is resolved through the caller's own session before anything else, so
 * another account's chat is a 404. Restoring is a write to a machine, so it is
 * same-origin checked and refused while a turn holds the lease.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = { "cache-control": "no-store" } as const;
const MAX_LABEL = 80;

type Params = { params: Promise<{ chatId: string }> };

function unavailable() {
  return NextResponse.json(
    { enabled: false, error: "Versions are not available on this deployment." },
    { status: 404, headers: NO_STORE }
  );
}

async function chatBelongsTo(
  session: Awaited<ReturnType<typeof getSession>>,
  chatId: string
): Promise<boolean> {
  if (session.state !== "signed-in") return false;

  const { data } = await session.supabase
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .maybeSingle();

  return Boolean(data);
}

export async function GET(_request: Request, { params }: Params) {
  if (!checkpointsEnabled()) return unavailable();

  const session = await getSession();
  if (session.state !== "signed-in") {
    return NextResponse.json(
      { enabled: false, error: "Sign in first." },
      { status: 401, headers: NO_STORE }
    );
  }

  const { chatId } = await params;

  if (!(await chatBelongsTo(session, chatId))) {
    return NextResponse.json(
      { enabled: true, error: "That chat does not exist." },
      { status: 404, headers: NO_STORE }
    );
  }

  const admin = supabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { enabled: false, error: "Supabase is not configured." },
      { status: 503, headers: NO_STORE }
    );
  }

  const checkpoints = await listCheckpoints(admin, chatId);

  return NextResponse.json(
    {
      enabled: true,
      checkpoints: checkpoints.map((row) => ({
        sha: row.commitSha,
        label: row.label,
        files: row.filesChanged,
        source: row.source,
        createdAt: row.createdAt,
      })),
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: Request, { params }: Params) {
  if (!checkpointsEnabled()) return unavailable();

  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "That request came from another origin." },
      { status: 403, headers: NO_STORE }
    );
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return NextResponse.json(
      { error: "Sign in first." },
      { status: 401, headers: NO_STORE }
    );
  }

  const { chatId } = await params;

  if (!(await chatBelongsTo(session, chatId))) {
    return NextResponse.json(
      { error: "That chat does not exist." },
      { status: 404, headers: NO_STORE }
    );
  }

  const admin = supabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase is not configured, so a version cannot be recorded." },
      { status: 503, headers: NO_STORE }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: unknown; sha?: unknown; label?: unknown }
    | null;

  const action = body && typeof body.action === "string" ? body.action.trim() : "";

  if (action === "save") {
    const label =
      body && typeof body.label === "string"
        ? body.label.trim().slice(0, MAX_LABEL)
        : undefined;

    const saved = await saveCheckpoint({
      admin,
      chatId,
      owner: session.user.id,
      label,
    });

    if (!saved.ok) {
      return NextResponse.json(
        { error: saved.message, failure: saved.failure },
        { status: saved.failure === "busy" ? 409 : saved.failure === "no_workspace" ? 409 : 502, headers: NO_STORE }
      );
    }

    return NextResponse.json(
      { created: saved.created, checkpoint: saved.checkpoint ?? null },
      { headers: NO_STORE }
    );
  }

  if (action === "restore") {
    const sha = body && typeof body.sha === "string" ? body.sha.trim() : "";

    const restored = await restoreCheckpoint({
      admin,
      chatId,
      owner: session.user.id,
      sha,
    });

    if (!restored.ok) {
      return NextResponse.json(
        { error: restored.message, failure: restored.failure },
        {
          status:
            restored.failure === "busy"
              ? 409
              : restored.failure === "unknown_version"
                ? 404
                : restored.failure === "no_workspace"
                  ? 409
                  : 502,
          headers: NO_STORE,
        }
      );
    }

    return NextResponse.json({ head: restored.head }, { headers: NO_STORE });
  }

  return NextResponse.json(
    { error: 'action must be "save" or "restore".' },
    { status: 400, headers: NO_STORE }
  );
}
