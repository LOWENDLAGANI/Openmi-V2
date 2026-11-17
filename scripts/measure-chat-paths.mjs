#!/usr/bin/env bun
// ── Where a chat open and a send actually spend their round trips ────────────
//
// There are no Supabase or E2B credentials in this workspace, so nothing here
// talks to a deployment. Instead it drives the send path's real transcript
// writer (`appendRunMessages`) against a stub client that counts calls and
// charges a fixed simulated latency, and it runs the stage plans that mirror
// `app/chat/page.tsx` and `app/api/chat/route.ts`.
//
//   bun scripts/measure-chat-paths.mjs [latencyMs]
//
// A "round trip" is one call to the data layer. A "wait" is one stage: a stage
// is a single `await` of a `Promise.all`, so a request's latency is roughly
// stages × per-call latency. Both numbers are reported, because the second is
// what the reader feels.

import { performance } from "node:perf_hooks";

import { appendRunMessages } from "../lib/runs/store.ts";

const LATENCY_MS = Number(process.argv[2] ?? 20);
const RUN = "11111111-1111-4111-8111-111111111111";

function stub({ latency = LATENCY_MS, batch = "present" } = {}) {
  let calls = 0;

  const hit = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, latency));
  };

  const client = {
    get calls() {
      return calls;
    },
    hit,
    async rpc(name, args) {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, latency));

      if (name === "append_run_messages") {
        if (batch === "absent") {
          return {
            data: null,
            error: {
              message:
                "Could not find the function public.append_run_messages(p_messages, p_run) in the schema cache",
            },
          };
        }

        return { data: args.p_messages.length, error: null };
      }

      return { data: 1, error: null };
    },
  };

  return client;
}

async function runStages(client, stages) {
  const started = performance.now();

  for (const names of stages) {
    await Promise.all(names.map(() => client.hit()));
  }

  return {
    calls: client.calls,
    waits: stages.length,
    ms: performance.now() - started,
  };
}

/**
 * The plans below mirror the code paths, one entry per call. Stage plans are a
 * model, not a trace: the counts are the calls the source makes on each path,
 * and the elapsed time is real (simulated latency), so the ratio between two
 * plans is meaningful even though an absolute number is not.
 */

// `getSession` is two calls: `auth.getUser` and the ban column on the profile.
const session = ["session:getUser", "session:profile"];

const OPEN_BEFORE = [
  session,
  // awaited before anything rendered
  ["refill_daily_credit"],
  ["folders", "chats", "github:token", "profile", "hour_session"],
  // readAdminAccess() with no session passed: getUser + profile + is_admin
  ["admin:getUser", "admin:profile", "is_admin"],
  [
    "messages",
    "changesets",
    "changeset_files",
    "runs",
    "profile",
    "branch_autoapprovals",
    "citation:token",
    "github:tree",
  ],
];

const OPEN_AFTER = [
  session,
  // refill travels with the page's reads
  ["refill_daily_credit", "folders", "chats", "github:token", "profile", "hour_session"],
  // admin check joins this batch; the citation tree is bounded by a deadline
  [
    "messages",
    "changesets",
    "changeset_files",
    "runs",
    "profile",
    "branch_autoapprovals",
    "citation:token",
    "github:tree",
    "is_admin",
  ],
];

const historyCopies = (count) =>
  Array.from({ length: count }, () => ["append_run_message"]);

const SEND_BEFORE = [
  session,
  ["rate_limit"],
  ["chat"],
  ["trial_grant"],
  ["start_hour_session"],
  ["append_message"],
  ["settle_stalled_runs"],
  ["run_quota"],
  ["list_messages"],
  ["create_run"],
  ...historyCopies(12),
];

const SEND_AFTER = [
  session,
  ["rate_limit"],
  ["chat", "trial_grant"],
  ["start_hour_session"],
  ["append_message", "settle_stalled_runs"],
  ["run_quota", "list_messages"],
  ["create_run"],
  ["append_run_messages"],
];

const transcript = Array.from({ length: 12 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  text: `message ${index + 1}`,
}));

const openBefore = await runStages(stub(), OPEN_BEFORE);
const openAfter = await runStages(stub(), OPEN_AFTER);
const sendBefore = await runStages(stub(), SEND_BEFORE);
const sendAfter = await runStages(stub(), SEND_AFTER);

// The one part of the send path that is real code rather than a plan: the
// batched writer, with and without migration 054.
const batchStub = stub({ batch: "present" });
let started = performance.now();
const batchWritten = await appendRunMessages(batchStub, RUN, transcript);
const batchMs = performance.now() - started;

const fallbackStub = stub({ batch: "absent" });
started = performance.now();
const fallbackWritten = await appendRunMessages(fallbackStub, RUN, transcript);
const fallbackMs = performance.now() - started;

const row = (label, result) =>
  `${label.padEnd(18)} ${String(result.calls).padStart(3)} calls   ${String(
    result.waits
  ).padStart(2)} waits   ${result.ms.toFixed(0).padStart(4)} ms`;

console.log(`stub latency: ${LATENCY_MS} ms per call\n`);
console.log(row("open — before", openBefore));
console.log(row("open — after", openAfter));
console.log("");
console.log(row("send — before", sendBefore));
console.log(row("send — after", sendAfter));
console.log("");
console.log(
  `appendRunMessages, migration applied: ${batchStub.calls} call, ${batchMs.toFixed(
    0
  )} ms, wrote ${batchWritten}`
);
console.log(
  `appendRunMessages, migration missing: ${fallbackStub.calls} calls, ${fallbackMs.toFixed(
    0
  )} ms, wrote ${fallbackWritten}`
);
