-- Phase 10: sandbox runs.
--
-- A run is one real observation of one proposed changeset: a Linux workspace at
-- the pinned commit, the accepted files applied, then install and build. The
-- card may only say what a row here recorded.
--
-- `stage` is where it got to, `failure_code` is why it stopped, and neither is
-- derived from a log line. A run that never reported leaves `heartbeat_at`
-- behind, which is how a stale row becomes "stopped reporting" instead of a
-- card that waits forever.
--
-- Two tables, both owner-scoped. Writes go through the service role in the run
-- route; a client may only read its own rows, which is what the policies below
-- grant.

create table if not exists public.execution_runs (
  id              uuid primary key default gen_random_uuid(),
  owner           uuid not null references auth.users(id) on delete cascade,
  chat_id         uuid not null references public.chats(id) on delete cascade,
  changeset_id    uuid not null references public.changesets(id) on delete cascade,
  repo_full_name  text not null,
  base_sha        text not null,
  status          text not null default 'queued'
                    check (status in ('queued','running','done','failed','timed_out','cancelled')),
  stage           text not null default 'provision'
                    check (stage in ('provision','seed','apply','install','build','typecheck')),
  failure_code    text,
  failure_detail  text,
  sandbox_id      text,
  install_command text,
  build_command   text,
  exit_code       integer,
  duration_ms     integer,
  reserved_dew    numeric(10,3) not null default 0,
  charged_dew     numeric(10,3) not null default 0,
  heartbeat_at    timestamptz,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz
);

-- One live run per account. Two concurrent sandboxes would double the bill and
-- race the same changeset, and there is no product reason to allow it.
create unique index if not exists execution_runs_one_active_per_owner
  on public.execution_runs (owner)
  where status in ('queued','running');

create index if not exists execution_runs_changeset_idx
  on public.execution_runs (changeset_id, started_at desc);

create table if not exists public.execution_events (
  id      bigserial primary key,
  run_id  uuid not null references public.execution_runs(id) on delete cascade,
  owner   uuid not null references auth.users(id) on delete cascade,
  seq     integer not null,
  at      timestamptz not null default now(),
  kind    text not null check (kind in ('status','step','output','observation')),
  body    text not null,
  unique (run_id, seq)
);

create index if not exists execution_events_run_idx
  on public.execution_events (run_id, seq);

alter table public.execution_runs enable row level security;
alter table public.execution_events enable row level security;

drop policy if exists "execution_runs: owner reads" on public.execution_runs;
create policy "execution_runs: owner reads"
  on public.execution_runs for select
  using (auth.uid() = owner);

drop policy if exists "execution_events: owner reads" on public.execution_events;
create policy "execution_events: owner reads"
  on public.execution_events for select
  using (auth.uid() = owner);

grant select on public.execution_runs to authenticated;
grant select on public.execution_events to authenticated;
