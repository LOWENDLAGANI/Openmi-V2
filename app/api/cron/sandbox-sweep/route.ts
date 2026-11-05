import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  CHAT_SANDBOX_PROVISION_ORPHAN_MS,
  chatSandboxIdleMinutes,
  chatSandboxTtlMinutes,
  isLeaseLive,
  toMillis,
} from "@/lib/execution/chat-env/lifecycle";
import {
  chatSandboxCounts,
  deleteChatSandboxRow,
  listChatSandboxesDue,
  listChatSandboxesIdle,
  listChatSandboxIds,
  updateChatSandbox,
} from "@/lib/execution/chat-env/store";
import {
  SandboxStartError,
  attachSandbox,
  destroySandboxConfirmed,
  executionConfigured,
  listChatSandboxes,
} from "@/lib/execution/provider";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The clock behind the chat environment promise.
 *
 * Order is wipe → stop → reconcile. Wiping first means a box that is already
 * due is not stopped first and left for a second pass; reconciling last means a
 * container that a crash left unrecorded is still found by its label.
 *
 * The route trusts exactly one credential — `Authorization: Bearer
 * $CRON_SECRET` — and refuses to run at all without one. It is safe to call by
 * hand with `?dry=1`: that returns what it would do and writes nothing.
 *
 * Leases are honoured on every pass. A turn that started a second before the
 * deadline holds the row, and neither the idle stop nor the wipe may touch it.
 */

type PassReport = {
  pass: "expire" | "stop" | "reconcile";
  candidates: number;
  acted: number;
  failed: number;
  durationMs: number;
  dryRun: boolean;
};

function messageOf(caught: unknown): string {
  return caught instanceof Error && caught.message.length > 0
    ? caught.message
    : "The provider call failed.";
}

function missing(caught: unknown): boolean {
  return caught instanceof SandboxStartError && caught.failure === "missing";
}

/**
 * Compares through SHA-256 so the comparison is both constant-time and
 * length-independent. `timingSafeEqual` throws on different lengths, and
 * padding by hand is how a length check ends up back in the code.
 */
function authorised(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const given = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();

  return timingSafeEqual(a, b);
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  const secret = (process.env.CRON_SECRET ?? "").trim();

  if (secret.length === 0) {
    return json(
      {
        error:
          "CRON_SECRET is not set, so the sweep refuses to run unauthenticated. The provider timers still stop and wipe sandboxes.",
      },
      503
    );
  }

  if (!authorised(request, secret)) {
    return json({ error: "Unauthorised." }, 401);
  }

  if (!executionConfigured()) {
    return json({ ok: true, skipped: "execution-not-configured" });
  }

  const admin = supabaseAdmin();

  if (!admin) {
    return json({ error: "The database is not configured on this deployment." }, 503);
  }

  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  const now = Date.now();
  const reports: PassReport[] = [];

  // Expire: mark wiping, destroy, delete the row only after the provider agrees.
  const expireStarted = Date.now();
  const expire: PassReport = {
    pass: "expire",
    candidates: 0,
    acted: 0,
    failed: 0,
    durationMs: 0,
    dryRun,
  };

  try {
    const due = await listChatSandboxesDue(admin, now);
    expire.candidates = due.length;

    for (const row of due) {
      if (isLeaseLive(row.leaseUntil, now)) continue;

      if (dryRun) {
        expire.acted += 1;
        continue;
      }

      await updateChatSandbox(admin, row.id, {
        state: "wiping",
        lease_until: null,
        delete_after: new Date(now).toISOString(),
      });

      try {
        await destroySandboxConfirmed(row.sandboxId);
        await deleteChatSandboxRow(admin, row.id);
        expire.acted += 1;
      } catch (caught) {
        expire.failed += 1;

        // The row stays so the next sweep retries. Deleting it here is how a
        // container becomes invisible and keeps billing.
        await updateChatSandbox(admin, row.id, {
          wipe_attempts: row.wipeAttempts + 1,
          failure_code: "wipe_failed",
          failure_detail: messageOf(caught).slice(0, 2_000),
        });
      }
    }
  } catch (caught) {
    expire.failed += 1;
    expire.durationMs = Date.now() - expireStarted;
    reports.push(expire);

    return json(
      { ok: false, error: messageOf(caught), passes: reports },
      500
    );
  }

  expire.durationMs = Date.now() - expireStarted;
  reports.push(expire);

  // Stop: compute is released, the filesystem stays.
  const stopStarted = Date.now();
  const stop: PassReport = {
    pass: "stop",
    candidates: 0,
    acted: 0,
    failed: 0,
    durationMs: 0,
    dryRun,
  };

  try {
    const idleBefore = now - chatSandboxIdleMinutes() * 60_000;
    const idle = await listChatSandboxesIdle(admin, idleBefore);
    stop.candidates = idle.length;

    for (const row of idle) {
      if (isLeaseLive(row.leaseUntil, now)) continue;

      if (dryRun) {
        stop.acted += 1;
        continue;
      }

      try {
        const handle = await attachSandbox(row.sandboxId);
        const state = await handle.state();

        if (state === "started" || state === "stopping") {
          await handle.stop({ force: false });
        }

        if (
          state === "started" ||
          state === "stopping" ||
          state === "stopped"
        ) {
          await updateChatSandbox(admin, row.id, {
            state: "stopped",
            stopped_at: new Date(now).toISOString(),
            lease_until: null,
          });
          stop.acted += 1;
        }
        // A box that is still pending/starting is left alone: the provider is
        // driving it, and marking it stopped would be a lie the next turn acts on.
      } catch (caught) {
        if (missing(caught)) {
          // The provider lost the box. The row cannot be resumed, so it is
          // removed now rather than waiting for the deadline.
          await deleteChatSandboxRow(admin, row.id);
          stop.acted += 1;
          continue;
        }

        stop.failed += 1;
        await updateChatSandbox(admin, row.id, {
          failure_code: "stop_failed",
          failure_detail: messageOf(caught).slice(0, 2_000),
        });
      }
    }
  } catch (caught) {
    stop.failed += 1;
    stop.durationMs = Date.now() - stopStarted;
    reports.push(stop);

    return json(
      { ok: false, error: messageOf(caught), passes: reports },
      500
    );
  }

  stop.durationMs = Date.now() - stopStarted;
  reports.push(stop);

  // Reconcile: the provider is the only ledger that survives a crash between
  // create and row insert.
  const reconcileStarted = Date.now();
  const reconcile: PassReport = {
    pass: "reconcile",
    candidates: 0,
    acted: 0,
    failed: 0,
    durationMs: 0,
    dryRun,
  };

  try {
    const remote = await listChatSandboxes();
    const known = await listChatSandboxIds(admin);
    const orphans = remote.filter((sandbox) => !known.has(sandbox.id));
    reconcile.candidates = orphans.length;

    for (const sandbox of orphans) {
      const created = toMillis(sandbox.createdAt);

      // Never destroy a box whose age is unknown or younger than the orphan
      // window: a create that has not inserted its row yet looks exactly like
      // this, and killing it would race the turn that is seeding it.
      if (created === null || created + CHAT_SANDBOX_PROVISION_ORPHAN_MS > now) {
        continue;
      }

      if (dryRun) {
        reconcile.acted += 1;
        continue;
      }

      try {
        await destroySandboxConfirmed(sandbox.id);
        reconcile.acted += 1;
      } catch {
        reconcile.failed += 1;
      }
    }
  } catch {
    // A provider list failure is not a reason to fail the wipes that already
    // succeeded; the next run tries again.
    reconcile.failed += 1;
  }

  reconcile.durationMs = Date.now() - reconcileStarted;
  reports.push(reconcile);

  const counts = await chatSandboxCounts(admin, now);

  for (const report of reports) {
    console.log(
      JSON.stringify({
        pass: report.pass,
        candidates: report.candidates,
        acted: report.acted,
        failed: report.failed,
        durationMs: report.durationMs,
        dryRun: report.dryRun,
      })
    );
  }

  return json({
    ok: true,
    dryRun,
    passes: reports,
    totals: {
      ...counts,
      ttlMinutes: chatSandboxTtlMinutes(),
    },
  });
}
