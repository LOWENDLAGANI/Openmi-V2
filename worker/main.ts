/**
 * The worker's entry point.
 *
 * Run it on a machine that stays up — a small VM, a container with a restart
 * policy, or `bun run worker` beside `bun run dev`. It is deliberately not a
 * serverless function: a run lives for minutes and must survive the tab that
 * started it, a deploy, and a laptop closing.
 *
 *   bun run worker
 *
 * `server-only` is a Next bundler marker, not a runtime guard, and this process
 * is a server: the script is started with `--conditions=react-server` in
 * package.json so the modules the app also uses resolve for a server process.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

import { runWorker } from "@/lib/runs/worker";

async function main(): Promise<void> {
  const admin = supabaseAdmin();

  if (!admin) {
    console.error(
      "[runs] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
    );
    process.exit(1);
  }

  const controller = new AbortController();

  const stop = (signal: string) => {
    console.log(`[runs] ${signal} received; finishing in-flight work`);
    controller.abort();
  };

  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  // A rejection nobody handled must not take the queue down silently.
  process.on("unhandledRejection", (reason) => {
    console.error(
      `[runs] unhandled rejection: ${
        reason instanceof Error ? reason.message : String(reason)
      }`
    );
  });

  await runWorker({ admin, stopSignal: controller.signal });
}

void main().catch((caught: unknown) => {
  console.error(
    `[runs] worker exited: ${caught instanceof Error ? caught.message : String(caught)}`
  );
  process.exit(1);
});
