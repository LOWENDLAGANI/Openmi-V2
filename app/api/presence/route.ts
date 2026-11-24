import { NextResponse } from "next/server";

import {
  sanitizePresencePath,
  sanitizeVisitorId,
} from "@/lib/admin/presence-types";
import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Records a lightweight heartbeat for the current visitor or signed-in member.
 *
 * Always same-origin and best-effort: a missing table (before migration 060 is
 * pushed) or transient database error never breaks page navigation.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return json({ error: "Cross-origin request refused." }, 403);
  }

  const admin = supabaseAdmin();
  if (!admin) return json({ ok: false }, 200);

  const body = (await request.json().catch(() => null)) as {
    path?: unknown;
    visitorId?: unknown;
  } | null;

  const lastPath = sanitizePresencePath(body?.path);
  const session = await getSession();

  let sessionKey: string;
  let userId: string | null = null;
  let email: string | null = null;
  let handle: string | null = null;

  if (session.state === "signed-in") {
    sessionKey = `user:${session.user.id}`;
    userId = session.user.id;
    email = session.user.email ?? null;
    handle = email ? (email.split("@")[0] ?? null) : null;
  } else {
    const visitorId = sanitizeVisitorId(body?.visitorId);
    if (!visitorId) return json({ ok: false }, 200);
    sessionKey = `anon:${visitorId}`;
  }

  const nowIso = new Date().toISOString();

  const { error } = await admin.from("user_presence").upsert(
    {
      session_key: sessionKey,
      user_id: userId,
      email,
      handle,
      last_path: lastPath,
      last_seen_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "session_key" }
  );

  return json({ ok: !error }, 200);
}
