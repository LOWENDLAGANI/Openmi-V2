import { NextResponse } from "next/server";

import { deploymentUrl, isPublishableSha, publishEnabled } from "@/lib/publish/plan";
import { publishChat, refreshDeployment } from "@/lib/publish/session";
import { readToken } from "@/lib/github/token";
import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Publishing, and reading what was published.
 *
 * GET is the poll: it refreshes a building deployment and returns only what the
 * provider reported. The URL is rendered through `deploymentUrl`, so a queued or
 * failed deployment has none.
 *
 * POST starts a deployment of the pinned branch's head with the reader's GitHub
 * token and the operator's hosting token. Both are server-side; neither is
 * returned.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = { "cache-control": "no-store" } as const;

type Params = { params: Promise<{ chatId: string }> };

async function ownedChat(
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
  const session = await getSession();
  if (session.state !== "signed-in") {
    return NextResponse.json(
      { enabled: publishEnabled(), error: "Sign in first." },
      { status: 401, headers: NO_STORE }
    );
  }

  const { chatId } = await params;

  if (!(await ownedChat(session, chatId))) {
    return NextResponse.json(
      { enabled: publishEnabled(), error: "That chat does not exist." },
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

  const row = await refreshDeployment({ admin, chatId });

  if (!row) {
    return NextResponse.json(
      { enabled: publishEnabled(), deployment: null },
      { headers: NO_STORE }
    );
  }

  return NextResponse.json(
    {
      enabled: publishEnabled(),
      deployment: {
        state: row.state,
        url: deploymentUrl(row.state, row.url),
        branch: row.branch,
        commitSha: isPublishableSha(row.commitSha) ? row.commitSha : null,
        error: row.errorMessage,
        createdAt: row.createdAt,
      },
    },
    { headers: NO_STORE }
  );
}

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

  if (!(await ownedChat(session, chatId))) {
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
      { error: "Connect GitHub before publishing." },
      { status: 400, headers: NO_STORE }
    );
  }

  const published = await publishChat({
    admin,
    supabase: session.supabase,
    chatId,
    owner: session.user.id,
    githubToken: github.token,
  });

  if (!published.ok) {
    return NextResponse.json(
      { error: published.message, code: published.code },
      {
        status:
          published.code === "not_configured"
            ? 503
            : published.code === "no_repository"
              ? 409
              : 502,
        headers: NO_STORE,
      }
    );
  }

  return NextResponse.json(
    {
      state: published.deployment.state,
      url: deploymentUrl(published.deployment.state, published.deployment.url),
      error: published.deployment.errorMessage,
    },
    { headers: NO_STORE }
  );
}
