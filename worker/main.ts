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
 * With `PORT` set (Render and most hosts inject it), it also answers
 * `GET /healthz` on that port. That is what lets the same image run as a free
 * **Web Service**: the host gets the port and a health check it understands,
 * and the worker keeps polling the queue behind it. The endpoint is the only
 * route and it carries counters, never run content.
 *
 * `server-only` is a Next bundler marker, not a runtime guard, and this process
 * is a server: the script is started with `--conditions=react-server` in
 * package.json so the modules the app also uses resolve for a server process.
 */

import { createServer } from "node:http";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { workerConcurrency } from "@/lib/runs/limits";
import {
  createWorkerStatus,
  newWorkerId,
  runWorker,
} from "@/lib/runs/worker";

async function main(): Promise<void> {
  const admin = supabaseAdmin();

  if (!admin) {
    console.error(
      "[runs] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
    );
    process.exit(1);
  }

  const concurrency = workerConcurrency();
  const workerId = newWorkerId();
  const status = createWorkerStatus({ workerId, concurrency });

  const controller = new AbortController();

  const rawPort = Number((process.env.PORT ?? "").trim());
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 0;

  const server =
    port > 0
      ? createServer((request, response) => {
          if (request.method === "GET" && request.url === "/healthz") {
            response.writeHead(200, {
              "content-type": "application/json",
              "cache-control": "no-store",
            });
            response.end(
              JSON.stringify({
                ok: true,
                ...status,
                uptimeSeconds: Math.round(process.uptime()),
              })
            );
            return;
          }

          response.writeHead(404, { "content-type": "text/plain" });
          response.end("Not found. This process exposes /healthz only.");
        })
      : null;

  if (server) {
    server.listen(port, "0.0.0.0", () => {
      console.log(`[runs] health on 0.0.0.0:${port}/healthz`);
    });
  }

  const stop = (signal: string) => {
    console.log(`[runs] ${signal} received; finishing in-flight work`);
    controller.abort();
    server?.close();
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

  await runWorker({
    admin,
    workerId,
    status,
    concurrency,
    stopSignal: controller.signal,
  });

  server?.close();
}

void main().catch((caught: unknown) => {
  console.error(
    `[runs] worker exited: ${caught instanceof Error ? caught.message : String(caught)}`
  );
  process.exit(1);
});
