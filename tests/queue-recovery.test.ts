import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * The queue recovers from a dead worker.
 *
 * `runs_one_active_per_owner` refuses every new run while a leftover row sits in
 * it. Before 047 nothing settled a `queued` row, so one message sent while the
 * worker was down locked the account out of chatting for good — "you already
 * have a run in progress" forever, and a chat that spun "working".
 */

const ROOT = join(import.meta.dir, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

const OWNER = "88888888-8888-4888-8888-888888888888";
const OTHER = "99999999-9999-4999-8999-999999999999";
const THIRD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOURTH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create or replace function auth.uid() returns uuid
    language sql stable
    as $$
      select nullif(
        current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
        ''
      )::uuid
    $$;

  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end
  $$;

  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHIM);

  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }

  await db.query(
    "insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6), ($7, $8)",
    [
      OWNER,
      "a@example.test",
      OTHER,
      "b@example.test",
      THIRD,
      "c@example.test",
      FOURTH,
      "d@example.test",
    ]
  );
});

afterAll(async () => {
  await db.close();
});

let seq = 0;

/** Each test starts from an empty queue: the index is per owner, on purpose. */
async function resetRuns() {
  await db.exec("reset role");
  await db.exec("delete from public.runs");
}

/** A run row with an exact age, so "twenty minutes" is testable. */
async function insertRun(input: {
  owner: string;
  status: "queued" | "running";
  minutesAgo: number;
  heartbeatMinutesAgo?: number | null;
}) {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const created = `now() - interval '${input.minutesAgo} minutes'`;
  const beat =
    input.heartbeatMinutesAgo === null
      ? "null"
      : input.heartbeatMinutesAgo === undefined
        ? created
        : `now() - interval '${input.heartbeatMinutesAgo} minutes'`;

  // A queued run has not been claimed, so it has no start time — that is what
  // separates "nobody picked this up" from "a worker took it and vanished".
  const started = input.status === "queued" ? "null" : created;

  await db.query(
    `insert into public.runs (id, owner, prompt, model, status, created_at, started_at, heartbeat_at)
     values ($1, $2, 'test', 'auto', $3, ${created}, ${started}, ${beat})`,
    [id, input.owner, input.status]
  );

  return id;
}

/** The fields the retry rule turns on. */
async function runFull(id: string) {
  const { rows } = await db.query(
    "select status, retry_count, started_at, created_at, ended_at, error from public.runs where id = $1",
    [id]
  );
  return rows[0] as {
    status: string;
    retry_count: number;
    started_at: string | null;
    created_at: string;
    ended_at: string | null;
    error: string | null;
  };
}

async function runEvents(id: string) {
  const { rows } = await db.query(
    "select kind, payload from public.run_events where run_id = $1 order by seq",
    [id]
  );
  return rows as Array<{ kind: string; payload: Record<string, unknown> }>;
}

async function runRow(id: string) {
  const { rows } = await db.query(
    "select status, stop_reason, error, ended_at from public.runs where id = $1",
    [id]
  );
  return rows[0] as {
    status: string;
    stop_reason: string | null;
    error: string | null;
    ended_at: string | null;
  };
}

test("a queued run nobody claimed stops holding the account hostage", async () => {
  await resetRuns();

  const stale = await insertRun({ owner: OWNER, status: "queued", minutesAgo: 25 });

  // The index is what refuses the next chat.
  await expect(
    insertRun({ owner: OWNER, status: "queued", minutesAgo: 0 })
  ).rejects.toThrow(/duplicate key|unique/i);

  const { rows } = await db.query(
    "select status from public.settle_stalled_runs($1)",
    [OWNER]
  );
  expect(rows).toHaveLength(1);

  const settled = await runRow(stale);
  expect(settled.status).toBe("failed");
  expect(settled.stop_reason).toBe("error");
  expect(settled.error).toContain("No worker picked this run up");
  expect(settled.ended_at).not.toBeNull();

  // The account can chat again.
  const next = await insertRun({ owner: OWNER, status: "queued", minutesAgo: 0 });
  expect(next.length).toBeGreaterThan(0);
});

test("a run inside the queue window is left alone", async () => {
  await resetRuns();

  const fresh = await insertRun({ owner: OTHER, status: "queued", minutesAgo: 3 });

  await db.query("select 1 from public.settle_stalled_runs($1)", [OTHER]);

  expect((await runRow(fresh)).status).toBe("queued");
});

test("a silent worker's run is handed back once, and settled if it stalls again", async () => {
  await resetRuns();

  const dead = await insertRun({
    owner: THIRD,
    status: "running",
    minutesAgo: 30,
    heartbeatMinutesAgo: 12,
  });
  const alive = await insertRun({
    owner: FOURTH,
    status: "running",
    minutesAgo: 30,
    heartbeatMinutesAgo: 0,
  });

  await db.query("select 1 from public.settle_stalled_runs($1)", [THIRD]);
  await db.query("select 1 from public.settle_stalled_runs($1)", [FOURTH]);

  // The machine vanished, so the work goes back to the queue — once.
  const requeued = await runFull(dead);
  expect(requeued.status).toBe("queued");
  expect(Number(requeued.retry_count)).toBe(1);
  expect(requeued.started_at).toBeNull();
  expect(requeued.ended_at).toBeNull();

  // It enters the queue as a new arrival, so the twenty-minute rule reads the
  // retry's own wait rather than the original run's age.
  expect(Date.parse(requeued.created_at)).toBeGreaterThan(Date.now() - 60_000);

  // The reader is told, in the run's own log, exactly once.
  const events = await runEvents(dead);
  expect(events).toHaveLength(1);
  expect(events[0]?.kind).toBe("run.warning");
  expect(events[0]?.payload.code).toBe("worker-lost-retry");

  // The run that is still reporting is untouched.
  expect((await runRow(alive)).status).toBe("running");

  // Claimed again and lost again: the counter stops a second retry.
  await db.query(
    "update public.runs set status = 'running', started_at = now(), heartbeat_at = now() - interval '30 minutes', worker_id = 'render-a' where id = $1",
    [dead]
  );

  await db.query("select 1 from public.settle_stalled_runs($1)", [THIRD]);

  const settled = await runRow(dead);
  expect(settled.status).toBe("failed");
  expect(settled.error).toContain("worker stopped reporting");
  expect(Number((await runFull(dead)).retry_count)).toBe(1);
});

test("a running row that never wrote a heartbeat is retried, then settled", async () => {
  await resetRuns();

  const orphan = await insertRun({
    owner: OWNER,
    status: "running",
    minutesAgo: 40,
    heartbeatMinutesAgo: null,
  });

  await db.query("select 1 from public.settle_stalled_runs($1)", [OWNER]);

  // A null heartbeat falls back to the start time, so the row is not immortal —
  // it is work that goes back to the queue once.
  const retried = await runFull(orphan);
  expect(retried.status).toBe("queued");
  expect(Number(retried.retry_count)).toBe(1);
});

test("a requeued run waiting too long is settled, not left holding the account", async () => {
  await resetRuns();

  const run = await insertRun({
    owner: OTHER,
    status: "running",
    minutesAgo: 30,
    heartbeatMinutesAgo: 12,
  });

  await db.query("select 1 from public.settle_stalled_runs($1)", [OTHER]);
  expect((await runRow(run)).status).toBe("queued");

  // Backdate the retry's own arrival past the queue window: nobody claimed it
  // this time either, and the account must be free again.
  await db.query(
    "update public.runs set created_at = now() - interval '25 minutes' where id = $1",
    [run]
  );

  const { rows } = await db.query(
    "select status from public.settle_stalled_runs($1)",
    [OTHER]
  );
  expect(rows.length).toBeGreaterThan(0);

  const settled = await runRow(run);
  expect(settled.status).toBe("failed");
  expect(settled.error).toContain("No worker picked this run up");
});

test("stopping a queued run releases it, because no worker will read the flag", async () => {
  await resetRuns();

  const queued = await insertRun({ owner: OTHER, status: "queued", minutesAgo: 0 });

  const { rows } = await db.query(
    "select public.request_run_cancel($1, $2) as cancelled",
    [queued, OTHER]
  );
  expect((rows[0] as { cancelled: boolean }).cancelled).toBe(true);

  const row = await runRow(queued);
  expect(row.status).toBe("cancelled");
  expect(row.stop_reason).toBe("user");
  expect(row.ended_at).not.toBeNull();

  // The index is free again.
  const next = await insertRun({ owner: OTHER, status: "queued", minutesAgo: 0 });
  expect(next.length).toBeGreaterThan(0);
});

test("settling is a service-role action, not something an account can run", async () => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: OWNER, role: "authenticated" }),
  ]);
  await db.exec("set role authenticated");

  await expect(
    db.query("select * from public.settle_stalled_runs($1)", [OTHER])
  ).rejects.toThrow(/permission denied/i);

  await db.exec("reset role");
});

test("the app settles before queuing, and the read that drives the spinner agrees", () => {
  const read = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  const chat = read("app/api/chat/route.ts");
  const runs = read("app/api/runs/route.ts");
  const page = read("app/chat/page.tsx");
  const store = read("lib/runs/store.ts");
  const turn = read("app/api/chat/turn/route.ts");

  // Before the quota read — otherwise the leftover is what the quota counts.
  const settleAt = chat.indexOf("await settleStalledRuns(admin, session.user.id)");
  const quotaAt = chat.indexOf("const quota = await readQuota(admin, session.user.id)");
  expect(settleAt).toBeGreaterThan(-1);
  expect(quotaAt).toBeGreaterThan(settleAt);

  // And once more after a duplicate-key refusal, before the 409 is believed.
  expect(chat.match(/settleStalledRuns\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(runs).toContain("settleStalledRuns(admin, session.user.id)");

  // The spinner read is bounded the same way, so a dead row is not "working".
  expect(page).toContain("heartbeat_at.gte.");
  expect(page).toContain("created_at.gte.");

  // The reaper covers both stalls and the null-heartbeat branch.
  expect(store).toContain("heartbeat_at.is.null");
  expect(store).toContain('eq("status", "queued")');

  // An open tab polls this route while it waits. It settles the same leftover
  // and applies the same ages, or "working on the server" never ends.
  expect(turn).toContain("settleStalledRuns(admin, session.user.id)");
  expect(turn).toContain("RUN_QUEUE_WAIT_MS");
  expect(turn).toContain("RUN_HEARTBEAT_STALE_MS");

  // The stream is the only reader left when the tab is still open, so it
  // settles its own stale row and reports the reason instead of going quiet.
  expect(chat).toContain("stalledFor(");
  expect(chat).toContain("settleStalledRuns(admin, session.user.id)");
});
