-- Web agent: a run the server owns from start to finish.
--
-- The old chat turn lived inside one request. A run does not: a worker claims
-- it from a queue, executes the loop, appends every step and event to these
-- tables, and the browser only ever reads them. Nothing here trusts the client
-- for authorship — every write goes through the service role, and every read is
-- scoped to `auth.uid() = owner` by RLS.
--
-- `runs.status` is the only source of truth. Events are append-only, numbered
-- per run, so a reload replays what happened instead of guessing from the UI.

create table if not exists public.runs (
  id               uuid primary key default gen_random_uuid(),
  owner            uuid not null references auth.users(id) on delete cascade,
  chat_id          uuid references public.chats(id) on delete set null,
  repo_full_name   text,
  base_sha         text,
  prompt           text not null,
  model            text not null,
  status           text not null default 'queued'
                     check (status in ('queued','running','done','failed','cancelled','blocked')),
  stop_reason      text,
  error            text,
  sandbox_id       text,
  worker_id        text,
  steps            integer not null default 0,
  input_tokens     bigint not null default 0,
  output_tokens    bigint not null default 0,
  cost_usd         numeric(12,6) not null default 0,
  cancel_requested boolean not null default false,
  last_event_seq   integer not null default 0,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  heartbeat_at     timestamptz,
  ended_at         timestamptz
);

-- One live run per account. Two boxes racing the same repository doubles the
-- bill and there is no product reason to allow it.
create unique index if not exists runs_one_active_per_owner
  on public.runs (owner)
  where status in ('queued','running');

create index if not exists runs_queue_idx
  on public.runs (status, created_at);

create index if not exists runs_owner_idx
  on public.runs (owner, created_at desc);

create table if not exists public.run_events (
  id      bigserial primary key,
  run_id  uuid not null references public.runs(id) on delete cascade,
  owner   uuid not null references auth.users(id) on delete cascade,
  seq     integer not null,
  kind    text not null,
  payload jsonb not null default '{}'::jsonb,
  at      timestamptz not null default now(),
  unique (run_id, seq)
);

create index if not exists run_events_run_idx
  on public.run_events (run_id, seq);

create table if not exists public.run_steps (
  run_id        uuid not null references public.runs(id) on delete cascade,
  owner         uuid not null references auth.users(id) on delete cascade,
  idx           integer not null,
  system_hash   text,
  messages_hash text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  finish_reason text,
  tool_names    text[] not null default '{}',
  duration_ms   integer,
  created_at    timestamptz not null default now(),
  primary key (run_id, idx)
);

create table if not exists public.run_messages (
  run_id       uuid not null references public.runs(id) on delete cascade,
  owner        uuid not null references auth.users(id) on delete cascade,
  idx          integer not null,
  role         text not null check (role in ('user','assistant','tool','system')),
  content_json jsonb not null,
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  primary key (run_id, idx)
);

create table if not exists public.run_tool_calls (
  run_id      uuid not null references public.runs(id) on delete cascade,
  owner       uuid not null references auth.users(id) on delete cascade,
  step_idx    integer not null,
  idx         integer not null,
  name        text not null,
  args_json   jsonb,
  result_json jsonb,
  is_error    boolean not null default false,
  duration_ms integer,
  created_at  timestamptz not null default now(),
  primary key (run_id, step_idx, idx)
);

-- File bodies and the diff live in object storage, not in Postgres. The row is
-- the reference: path, kind, size, hash and where the bytes went.
create table if not exists public.run_artifacts (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.runs(id) on delete cascade,
  owner       uuid not null references auth.users(id) on delete cascade,
  path        text not null,
  kind        text not null check (kind in ('file','diff','log')),
  storage_key text not null,
  bytes       integer not null default 0,
  sha256      text,
  created_at  timestamptz not null default now()
);

create index if not exists run_artifacts_run_idx
  on public.run_artifacts (run_id, path);

-- The hard daily budget, per account per day. Enforced before a run is queued
-- and updated when it finishes; `runs` counts started runs, not answers.
create table if not exists public.run_usage_daily (
  owner      uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  runs       integer not null default 0,
  tokens_in  bigint not null default 0,
  tokens_out bigint not null default 0,
  cost_usd   numeric(12,6) not null default 0,
  primary key (owner, day)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read your own rows; write nothing. A run row is a record of something that
-- happened on the server, not a claim a browser may make.

alter table public.runs enable row level security;
alter table public.run_events enable row level security;
alter table public.run_steps enable row level security;
alter table public.run_messages enable row level security;
alter table public.run_tool_calls enable row level security;
alter table public.run_artifacts enable row level security;
alter table public.run_usage_daily enable row level security;

drop policy if exists "runs: owner reads" on public.runs;
create policy "runs: owner reads"
  on public.runs for select
  using (auth.uid() = owner);

drop policy if exists "run_events: owner reads" on public.run_events;
create policy "run_events: owner reads"
  on public.run_events for select
  using (auth.uid() = owner);

drop policy if exists "run_steps: owner reads" on public.run_steps;
create policy "run_steps: owner reads"
  on public.run_steps for select
  using (auth.uid() = owner);

drop policy if exists "run_messages: owner reads" on public.run_messages;
create policy "run_messages: owner reads"
  on public.run_messages for select
  using (auth.uid() = owner);

drop policy if exists "run_tool_calls: owner reads" on public.run_tool_calls;
create policy "run_tool_calls: owner reads"
  on public.run_tool_calls for select
  using (auth.uid() = owner);

drop policy if exists "run_artifacts: owner reads" on public.run_artifacts;
create policy "run_artifacts: owner reads"
  on public.run_artifacts for select
  using (auth.uid() = owner);

drop policy if exists "run_usage_daily: owner reads" on public.run_usage_daily;
create policy "run_usage_daily: owner reads"
  on public.run_usage_daily for select
  using (auth.uid() = owner);

grant select on public.runs to authenticated;
grant select on public.run_events to authenticated;
grant select on public.run_steps to authenticated;
grant select on public.run_messages to authenticated;
grant select on public.run_tool_calls to authenticated;
grant select on public.run_artifacts to authenticated;
grant select on public.run_usage_daily to authenticated;

-- ── Queue ────────────────────────────────────────────────────────────────────
-- The queue is the table. `for update skip locked` is the claim: two workers
-- never take the same run, and a worker that dies mid-run leaves a heartbeat
-- behind for the reaper instead of blocking the queue.

create or replace function public.claim_next_run(p_worker text)
returns setof public.runs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with next_run as (
    select id
      from public.runs
     where status = 'queued'
     order by created_at
     for update skip locked
     limit 1
  )
  update public.runs r
     set status = 'running',
         started_at = now(),
         heartbeat_at = now(),
         worker_id = p_worker
    from next_run
   where r.id = next_run.id
  returning r.*;
end;
$$;

-- ── Event log ────────────────────────────────────────────────────────────────
-- The sequence is allocated under a row lock, so two appends cannot share a
-- number and Last-Event-ID replay has no holes to guess about.

create or replace function public.append_run_event(
  p_run uuid,
  p_kind text,
  p_payload jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq   integer;
  v_owner uuid;
begin
  update public.runs
     set last_event_seq = last_event_seq + 1
   where id = p_run
  returning last_event_seq, owner into v_seq, v_owner;

  if v_seq is null then
    raise exception 'run % does not exist', p_run;
  end if;

  insert into public.run_events (run_id, owner, seq, kind, payload)
  values (p_run, v_owner, v_seq, p_kind, p_payload);

  return v_seq;
end;
$$;

-- ── Steps ────────────────────────────────────────────────────────────────────
-- The counter advances by compare-and-set before the model call: a cancelled or
-- finished run matches no row, so a step can never be started on it. This is
-- what "persist before you proceed" means in SQL.

create or replace function public.begin_run_step(
  p_run uuid,
  p_system_hash text,
  p_messages_hash text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idx   integer;
  v_owner uuid;
begin
  update public.runs
     set steps = steps + 1
   where id = p_run
     and status = 'running'
     and cancel_requested = false
  returning steps, owner into v_idx, v_owner;

  if v_idx is null then
    return null;
  end if;

  insert into public.run_steps (run_id, owner, idx, system_hash, messages_hash)
  values (p_run, v_owner, v_idx, p_system_hash, p_messages_hash);

  return v_idx;
end;
$$;

create or replace function public.append_run_tool_call(
  p_run uuid,
  p_step_idx integer,
  p_idx integer,
  p_name text,
  p_args jsonb,
  p_result jsonb,
  p_is_error boolean,
  p_duration_ms integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner into v_owner from public.runs where id = p_run;
  if v_owner is null then
    raise exception 'run % does not exist', p_run;
  end if;

  insert into public.run_tool_calls (
    run_id, owner, step_idx, idx, name, args_json, result_json, is_error, duration_ms
  )
  values (
    p_run, v_owner, p_step_idx, p_idx, p_name, p_args, p_result, p_is_error, p_duration_ms
  )
  on conflict (run_id, step_idx, idx) do update
    set name = excluded.name,
        args_json = excluded.args_json,
        result_json = excluded.result_json,
        is_error = excluded.is_error,
        duration_ms = excluded.duration_ms;
end;
$$;

create or replace function public.append_run_message(
  p_run uuid,
  p_role text,
  p_content jsonb,
  p_tags text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idx   integer;
  v_owner uuid;
begin
  select owner into v_owner from public.runs where id = p_run;
  if v_owner is null then
    raise exception 'run % does not exist', p_run;
  end if;

  select coalesce(max(idx), 0) + 1 into v_idx
    from public.run_messages
   where run_id = p_run;

  insert into public.run_messages (run_id, owner, idx, role, content_json, tags)
  values (p_run, v_owner, v_idx, p_role, p_content, coalesce(p_tags, '{}'::text[]));

  return v_idx;
end;
$$;

-- ── Cancel ───────────────────────────────────────────────────────────────────
-- A flag, not a kill: the worker reads it at each step boundary and lets the
-- tool in flight finish. A half-applied edit is worse than a slow cancel.

create or replace function public.request_run_cancel(p_run uuid, p_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer;
begin
  update public.runs
     set cancel_requested = true
   where id = p_run
     and owner = p_owner
     and status in ('queued','running');

  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;

-- ── Budget ───────────────────────────────────────────────────────────────────
-- Read before queueing, written once at the end. One row per account per day.

create or replace function public.run_quota(p_owner uuid)
returns table (
  active integer,
  runs_today integer,
  tokens_today bigint,
  cost_today numeric
)
language sql
security definer
set search_path = public
as $$
  select
    (select count(*)::integer
       from public.runs
      where owner = p_owner and status in ('queued','running')),
    coalesce((select u.runs from public.run_usage_daily u
               where u.owner = p_owner and u.day = current_date), 0),
    coalesce((select u.tokens_in + u.tokens_out from public.run_usage_daily u
               where u.owner = p_owner and u.day = current_date), 0),
    coalesce((select u.cost_usd from public.run_usage_daily u
               where u.owner = p_owner and u.day = current_date), 0);
$$;

create or replace function public.record_run_usage(
  p_owner uuid,
  p_tokens_in bigint,
  p_tokens_out bigint,
  p_cost numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.run_usage_daily (owner, day, runs, tokens_in, tokens_out, cost_usd)
  values (p_owner, current_date, 1, greatest(p_tokens_in, 0), greatest(p_tokens_out, 0), greatest(p_cost, 0))
  on conflict (owner, day) do update
    set runs = public.run_usage_daily.runs + 1,
        tokens_in = public.run_usage_daily.tokens_in + greatest(excluded.tokens_in, 0),
        tokens_out = public.run_usage_daily.tokens_out + greatest(excluded.tokens_out, 0),
        cost_usd = public.run_usage_daily.cost_usd + greatest(excluded.cost_usd, 0);
end;
$$;

-- ── Privileges ───────────────────────────────────────────────────────────────
-- Only the worker may claim, append or record. A signed-in browser keeps its
-- read policies and gains no execute right on any mutating function.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete
      on public.runs, public.run_events, public.run_steps, public.run_messages,
         public.run_tool_calls, public.run_artifacts, public.run_usage_daily
      to service_role;
    grant usage, select on sequence public.run_events_id_seq to service_role;

    grant execute on function public.claim_next_run(text) to service_role;
    grant execute on function public.append_run_event(uuid, text, jsonb) to service_role;
    grant execute on function public.begin_run_step(uuid, text, text) to service_role;
    grant execute on function public.append_run_tool_call(uuid, integer, integer, text, jsonb, jsonb, boolean, integer) to service_role;
    grant execute on function public.append_run_message(uuid, text, jsonb, text[]) to service_role;
    grant execute on function public.request_run_cancel(uuid, uuid) to service_role;
    grant execute on function public.run_quota(uuid) to service_role;
    grant execute on function public.record_run_usage(uuid, bigint, bigint, numeric) to service_role;
  end if;
end $$;

revoke all on function public.claim_next_run(text) from public;
revoke all on function public.append_run_event(uuid, text, jsonb) from public;
revoke all on function public.begin_run_step(uuid, text, text) from public;
revoke all on function public.append_run_tool_call(uuid, integer, integer, text, jsonb, jsonb, boolean, integer) from public;
revoke all on function public.append_run_message(uuid, text, jsonb, text[]) from public;
revoke all on function public.request_run_cancel(uuid, uuid) from public;
revoke all on function public.record_run_usage(uuid, bigint, bigint, numeric) from public;
