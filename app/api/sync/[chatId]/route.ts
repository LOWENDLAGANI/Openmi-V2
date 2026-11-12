import { NextResponse } from "next/server";

import { pullChatBranch } from "@/lib/execution/sync/session";
import { readToken } from "@/lib/github/token";
import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Moving a chat's workspace to its branch head.
 *
 * POST only, and it writes one column: a pull is a pin change, not a git
 * operation on the sandbox, so the next turn reseeds through the path that
 * already exists. The chat is resolved through the caller's session first, so
 * another account's chat is a 404.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = { "cache-control": "no-store" } as const;

type Params = { params: Promise<{ chatId: string }> };

export async function POST(request: Request, { params }: Params) {
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

  const { data: chat } = await session.supabase
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .maybeSingle();

  if (!chat) {
    return NextResponse.json(
      { error: "That chat does not exist." },
      { status: 404, headers: NO_STORE }
    );
  }

  const admin = supabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 503, headers: NO_STORE }
    );
  }

  const github = await readToken(session.supabase, session.user.id);
  if (!github) {
    return NextResponse.json(
      { error: "Connect GitHub before pulling a branch." },
      { status: 400, headers: NO_STORE }
    );
  }

  const pulled = await pullChatBranch({
    admin,
    supabase: session.supabase,
    chatId,
    token: github.token,
  });

  if (!pulled.ok) {
    return NextResponse.json(
      { error: pulled.message, verdict: pulled.verdict },
      {
        status:
          pulled.verdict === "busy" || pulled.verdict === "uncommitted"
            ? 409
            : pulled.verdict === "no-repository"
              ? 409
              : 400,
        headers: NO_STORE,
      }
    );
  }

  return NextResponse.json(
    {
      verdict: pulled.verdict,
      head: pulled.head,
      previous: pulled.previous,
    },
    { headers: NO_STORE }
  );
}
