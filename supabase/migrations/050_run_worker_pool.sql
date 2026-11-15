-- More than one run worker.
--
-- The queue has always been safe for several workers (`for update skip locked`),
-- but nothing knew a worker existed: a run recorded a hostname-pid string, the
-- waker pinged one hardcoded URL, and a worker that died mid-run was settled as
-- failed with no second chance. This adds the bookkeeping that makes a fleet
-- work.
--
-- `run_workers` is what the waker reads: who is alive, how much room they have,
-- and where to reach them. It holds no run content and no credentials.
--
-- `runs.worker_pool` is written by `claim_next_run` in the same update as
-- `worker_id`, so the pair can never disagree. `retry_count` is what makes "one
-- retry, ever" enforceable across processes: the requeue is a compare-and-set on
-- `retry_count = 0`, so two servers cannot both decide to retry the same run.
-- `last_wake_at` / `wake_attempts` are the throttle that stops the escalation
-- from pinging a sleeping machine on every poll.

create table if not exists public.run_workers (
  id             text primary key,
  label          text,
  health_url     text,
  -- A dedicated pool (for example a high-memory member) claims only the runs
  -- given to it, without splitting the queue into another table.
  pool           text,
  concurrency    integer not null default 1,
  state          text not null default 'active'
                   check (state in ('active', 'draining', 'disabled')),
  active_runs    integer not null default 0,
  last_seen_at   timestamptz,
  last_woken_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The waker's query: active members, most recently seen first.
create index if not exists run_workers_seen_idx
  on public.run_workers (state, last_seen_at desc);

alter table public.run_workers enable row level security;

-- Service role only, like chat_sandboxes and sandbox_accounts: the browser never
-- names a worker and never wakes one.
revoke all on public.run_workers from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on public.run_workers to service_role;
  end if;
end $$;

drop trigger if exists run_workers_touch_updated_at on public.run_workers;
create trigger run_workers_touch_updated_at
  before update on public.run_workers
  for each row execute function public.touch_updated_at();

alter table public.runs
  add column if not exists worker_pool text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_wake_at timestamptz,
  add column if not exists wake_attempts integer not null default 0;

-- The requeue scan: running rows whose heartbeat has stopped.
create index if not exists runs_worker_lost_idx
  on public.runs (worker_id, heartbeat_at)
  where status = 'running';

comment on table public.run_workers is
  'The run worker fleet: who is alive, how busy, and where to wake them.';

comment on column public.runs.worker_pool is
  'The pool the claiming worker belongs to; set with worker_id in claim_next_run.';

comment on column public.runs.retry_count is
  '0 until a lost worker''s run is requeued once; it is never reset.';

-- ── Claim, with the pool recorded ─────────────────────────────────────────────
--
-- The ban check from 046 is kept: a run queued before a ban must not start after
-- it. The optional filter lets a dedicated pool take only its own work.

drop function if exists public.claim_next_run(text);

create or replace function public.claim_next_run(
  p_worker text,
  p_pool text default null,
  p_pool_filter text default null
)
returns setof public.runs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with next_run as (
    select r.id
      from public.runs r
     where r.status = 'queued'
       and not exists (
         select 1
           from public.profiles p
          where p.id = r.owner
            and p.banned_at is not null
            and (p.ban_expires_at is null or p.ban_expires_at > now())
       )
       and (
         p_pool_filter is null
         or r.worker_pool is null
         or r.worker_pool = p_pool_filter
       )
     order by r.created_at
     for update skip locked
     limit 1
  )
  update public.runs r
     set status       = 'running',
         started_at   = now(),
         heartbeat_at = now(),
         worker_id    = p_worker,
         worker_pool  = coalesce(p_pool, r.worker_pool)
    from next_run
   where r.id = next_run.id
  returning r.*;
end;
$$;

revoke all on function public.claim_next_run(text, text, text)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_next_run(text, text, text) to service_role;
  end if;
end $$;

-- ── Stalled runs: requeue once, then fail ────────────────────────────────────
--
-- This runs when an account queues a new run, so it is the one place that always
-- executes — no cron, no worker required. It now performs the same one retry the
-- worker's reaper does: a running row whose heartbeat stopped, never retried and
-- not cancelled, goes back to the queue instead of being failed.
--
-- `created_at` is reset on the retry on purpose. The age rules here (twenty
-- minutes to be claimed, five minutes without a heartbeat) are about waiting, and
-- a retry has waited zero seconds. The run id, its messages and its events keep
-- the history; the transcript is the handover.
--
-- The event is written in the same statement as the requeue, so a reader never
-- sees a run jump back to "queued" with no explanation.

create or replace function public.settle_stalled_runs(p_owner uuid)
returns setof public.runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_owner is null then
    return;
  end if;

  for v_id in
    with moved as (
      update public.runs r
         set status       = 'queued',
             worker_id    = null,
             worker_pool  = null,
             retry_count  = 1,
             started_at   = null,
             heartbeat_at = null,
             ended_at     = null,
             created_at   = now()
       where r.owner = p_owner
         and r.status = 'running'
         and r.retry_count = 0
         and coalesce(r.cancel_requested, false) = false
         and coalesce(r.heartbeat_at, r.started_at, r.created_at)
             < now() - interval '5 minutes'
      returning r.id
    )
    select id from moved
  loop
    perform public.append_run_event(
      v_id,
      'run.warning',
      jsonb_build_object(
        'code', 'worker-lost-retry',
        'message',
          'The machine running this stopped responding. Trying again on another machine.'
      )
    );
  end loop;

  return query
  update public.runs r
     set status = 'failed',
         stop_reason = 'error',
         error = case
           when r.status = 'queued'
             then 'No worker picked this run up. Start it again.'
           else 'The worker stopped reporting before this run finished. Start it again.'
         end,
         ended_at = now()
   where r.owner = p_owner
     and r.status in ('queued', 'running')
     and (
       (
         r.status = 'queued'
         and r.started_at is null
         and r.created_at < now() - interval '20 minutes'
       )
       or (
         r.status = 'running'
         and r.retry_count > 0
         and coalesce(r.heartbeat_at, r.started_at, r.created_at)
             < now() - interval '5 minutes'
       )
     )
  returning r.*;
end;
$$;

revoke all on function public.settle_stalled_runs(uuid)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.settle_stalled_runs(uuid) to service_role;
  end if;
end $$;

insert into public.openmi_meta (key, value)
values ('run_worker_pool', '1')
on conflict (key) do update set value = excluded.value;
