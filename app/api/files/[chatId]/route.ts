import { NextResponse } from "next/server";

import { filesEnabled } from "@/lib/files/plan";
import {
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from "@/lib/files/session";
import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The workspace's files, for the editor tab.
 *
 * GET lists the tree, or reads one file when `path` is given. PUT saves one
 * file. Both resolve the chat through the caller's session; a save is
 * same-origin checked and refused while a turn holds the lease.
 *
 * Nothing here touches GitHub. A save is a change on the sandbox's branch, and
 * the turn hook is what turns it into a version.
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

export async function GET(request: Request, { params }: Params) {
  if (!filesEnabled()) {
    return NextResponse.json(
      { enabled: false, error: "The file editor is not available on this deployment." },
      { status: 404, headers: NO_STORE }
    );
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return NextResponse.json(
      { enabled: false, error: "Sign in first." },
      { status: 401, headers: NO_STORE }
    );
  }

  const { chatId } = await params;

  if (!(await ownedChat(session, chatId))) {
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

  const path = new URL(request.url).searchParams.get("path");

  if (path === null) {
    const listed = await listWorkspaceFiles({
      admin,
      chatId,
      owner: session.user.id,
    });

    if (!listed.ok) {
      return NextResponse.json(
        { enabled: true, error: listed.message },
        { status: 409, headers: NO_STORE }
      );
    }

    return NextResponse.json(
      { enabled: true, files: listed.files },
      { headers: NO_STORE }
    );
  }

  const read = await readWorkspaceFile({
    admin,
    chatId,
    owner: session.user.id,
    path,
  });

  if (!read.ok) {
    return NextResponse.json(
      { enabled: true, error: read.message },
      { status: 400, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { enabled: true, path: read.path, text: read.text, bytes: read.bytes },
    { headers: NO_STORE }
  );
}

export async function PUT(request: Request, { params }: Params) {
  if (!filesEnabled()) {
    return NextResponse.json(
      { enabled: false, error: "The file editor is not available on this deployment." },
      { status: 404, headers: NO_STORE }
    );
  }

  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "That request came from another origin." },
      { status: 403, headers: NO_STORE }
    );
  }

  const session = await getSession();
  if (session.state !== "signed-in") {
    return NextResponse.json(
      { enabled: false, error: "Sign in first." },
      { status: 401, headers: NO_STORE }
    );
  }

  const { chatId } = await params;

  if (!(await ownedChat(session, chatId))) {
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

  const body = (await request.json().catch(() => null)) as
    | { path?: unknown; text?: unknown }
    | null;

  if (!body) {
    return NextResponse.json(
      { error: "A save needs a path and its text." },
      { status: 400, headers: NO_STORE }
    );
  }

  const written = await writeWorkspaceFile({
    admin,
    chatId,
    owner: session.user.id,
    path: body.path,
    text: body.text,
  });

  if (!written.ok) {
    return NextResponse.json(
      { enabled: true, error: written.message },
      { status: written.message.includes("A turn is using") ? 409 : 400, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    { enabled: true, path: written.path, bytes: written.bytes },
    { headers: NO_STORE }
  );
}
