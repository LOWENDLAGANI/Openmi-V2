import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";

/**
 * Sign-out is a POST so a link preview or a prefetch cannot end a session.
 * The redirect is a 303 so the browser follows it with a GET.
 */
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  await supabase?.auth.signOut();

  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
