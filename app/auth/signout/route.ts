import { NextResponse } from "next/server";

import { isSameOrigin } from "@/lib/http/origin";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Sign-out is a POST so a link preview or a prefetch cannot end a session.
 * The redirect is a 303 so the browser follows it with a GET.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "That request came from another origin." },
      { status: 403 }
    );
  }

  const supabase = await supabaseServer();
  await supabase?.auth.signOut();

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
