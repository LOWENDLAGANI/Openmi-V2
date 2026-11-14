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

  await db.query(
    `insert into public.runs (id, owner, prompt, model, status, created_at, started_at, heartbeat_at)
     values ($1, $2, 'test', 'auto', $3, ${created}, ${created}, ${beat})`,
    [id, input.owner, input.status]
  );

  return id;
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

test("a silent worker's run is settled; a heartbeating one is not", async () => {
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

  expect((await runRow(dead)).status).toBe("failed");
  expect((await runRow(alive)).status).toBe("running");
});

test("a running row that never wrote a heartbeat is not immortal", async () => {
  await resetRuns();

  const orphan = await insertRun({
    owner: OWNER,
    status: "running",
    minutesAgo: 40,
    heartbeatMinutesAgo: null,
  });

  await db.query("select 1 from public.settle_stalled_runs($1)", [OWNER]);

  expect((await runRow(orphan)).status).toBe("failed");
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
});
