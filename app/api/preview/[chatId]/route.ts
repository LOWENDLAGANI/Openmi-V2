import { NextResponse } from "next/server";

import { executionConfigured } from "@/lib/env";
import { previewEnabled } from "@/lib/execution/preview/plan";
import {
  enforcePreviewExpiry,
  startChatPreview,
  stopChatPreview,
} from "@/lib/execution/preview/session";
import { readChatPreview, touchChatPreview } from "@/lib/execution/preview/store";
import { isSameOrigin } from "@/lib/http/origin";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The preview's only endpoint.
 *
 * GET is what the panel polls for a state and, when there is one, a URL. POST
 * starts or stops the dev server. Both resolve the chat through the caller's own
 * session first, so a chat that is not theirs is indistinguishable from one that
 * does not exist: 404, never 403.
 *
 * The URL returned here is a public sandbox host. That is the honest exposure
 * model for this phase and the panel says so; the traffic token is never
 * returned, and a future private proxy changes the URL's origin without changing
 * this shape.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "cache-control": "no-store" } as const;

type Params = { params: Promise<{ chatId: string }> };

function unavailable() {
  return NextResponse.json(
    { enabled: false, error: "Previews are not available on this deployment." },
    { status: 404, headers: NO_STORE }
  );
}

/** Resolves a chat through the session client, so RLS decides ownership. */
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
  if (!previewEnabled()) return unavailable();

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

  // The limits are enforced on the reads the panel already makes: there is no
  // cron frequent enough to police an hour, and a start stops the previous
  // server anyway. This happens before the answer, so a preview that expires
  // now is reported as stopped rather than as ready and then gone.
  await enforcePreviewExpiry({ admin, chatId, owner: session.user.id });

  const preview = await readChatPreview(admin, chatId);

  // Looking at a running preview is what keeps it inside the idle window.
  if (preview?.state === "ready") {
    await touchChatPreview(admin, chatId);
  }

  return NextResponse.json(
    {
      enabled: true,
      configured: executionConfigured(),
      state: preview?.state ?? "stopped",
      url: preview?.url ?? null,
      port: preview?.port ?? null,
      command: preview?.command ?? null,
      failure: preview?.failureDetail ?? null,
      stopReason: preview?.stopReason ?? null,
      startedAt: preview?.startedAt ?? null,
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: Request, { params }: Params) {
  if (!previewEnabled()) return unavailable();

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
      { error: "Supabase is not configured, so a preview cannot be recorded." },
      { status: 503, headers: NO_STORE }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: unknown }
    | null;

  const action = body && typeof body.action === "string" ? body.action.trim() : "";

  if (action !== "start" && action !== "stop") {
    return NextResponse.json(
      { error: 'action must be "start" or "stop".' },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!executionConfigured()) {
    return NextResponse.json(
      { error: "Command execution isn't available right now, so nothing can be previewed." },
      { status: 503, headers: NO_STORE }
    );
  }

  if (action === "stop") {
    const stopped = await stopChatPreview({
      admin,
      chatId,
      owner: session.user.id,
    });

    if (!stopped.ok) {
      return NextResponse.json(
        { error: stopped.message },
        { status: 404, headers: NO_STORE }
      );
    }

    return NextResponse.json({ state: "stopped" }, { headers: NO_STORE });
  }

  // A start leaves a dev server running and wakes the box; a stop stays
  // unlimited so a reader who hit the cap can still shut one down.
  const limited = await checkRateLimit(admin, "preview", session.user.id);

  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: `Too many preview starts. Try again in ${limited.retryAfterSeconds} seconds.`,
      },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "retry-after": String(limited.retryAfterSeconds),
        },
      }
    );
  }

  const started = await startChatPreview({
    admin,
    chatId,
    owner: session.user.id,
  });

  if (!started.ok) {
    return NextResponse.json(
      { error: started.message, failure: started.failure },
      { status: started.failure === "no_workspace" ? 409 : 502, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    {
      state: "ready",
      url: started.url,
      port: started.port,
      command: started.command,
    },
    { headers: NO_STORE }
  );
}
