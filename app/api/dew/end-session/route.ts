import { NextResponse } from "next/server";

import { endHourSession } from "@/lib/dew/store";
import { isSameOrigin } from "@/lib/http/origin";
import { getSession } from "@/lib/session";

/**
 * Ends the running hour so a new one can start in the chat the reader is in.
 *
 * It is the "or end the session" half of the refusal the chat gate returns. No
 * refund: the hour was available and the reader chose to stop using it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "That request came from another origin.", ended: false },
      { status: 403, headers: NO_STORE }
    );
  }

  const session = await getSession();

  if (session.state !== "signed-in") {
    return NextResponse.json(
      { error: "Sign in first.", ended: false },
      { status: 401, headers: NO_STORE }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { chatId?: unknown }
    | null;

  const chatId =
    body && typeof body.chatId === "string" && body.chatId.length > 0
      ? body.chatId
      : null;

  const ended = await endHourSession(session.supabase, chatId);

  return NextResponse.json({ ended }, { headers: NO_STORE });
}
