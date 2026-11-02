"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client. Returns `null` when the project is not configured yet, so a
 * component can render "not set up" instead of crashing the page.
 */
export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  return createBrowserClient(url, anonKey);
}
