-- Phase 11: missions — a goal the agent works in a real Linux sandbox.
--
-- A mission is an `execution_runs` row with `kind = 'mission'`, not a second
-- table: billing, owner RLS, staleness and the one-active-run index must not
-- fork. What is new is the per-command ledger: a mission's card may only say
-- what `execution_commands` recorded, one row per command the model asked for.
--
-- The sandbox still holds no credential and still has no push path. Full access
-- means full access inside the box.

alter table public.execution_runs
  add column if not exists kind text not null default 'verify',
  add column if not exists goal text,
  add column if not exists autonomy text not null default 'act',
  add column if not exists model text,
  add column if not exists deadline_at timestamptz,
  add column if not exists last_tick_at timestamptz,
  add column if not exists commands_count integer not null default 0,
  add column if not exists changed_files integer,
  add column if not exists diff_bytes integer,
  add column if not exists result_changeset_id uuid
    references public.changesets(id) on delete set null;

-- A mission starts with no diff, so its changeset arrives at the end.
alter table public.execution_runs
  alter column changeset_id drop not null;

alter table public.execution_runs
  drop constraint if exists execution_runs_kind_check;
alter table public.execution_runs
  add constraint execution_runs_kind_check
  check (kind in ('verify', 'mission'));

alter table public.execution_runs
  drop constraint if exists execution_runs_autonomy_check;
alter table public.execution_runs
  add constraint execution_runs_autonomy_check
  check (autonomy in ('plan', 'act', 'ship'));

-- New states for a mission: paused while no tick is arriving, stalled when the
-- model stops acting. Both are non-terminal only while the mission can resume.
alter table public.execution_runs
  drop constraint if exists execution_runs_status_check;
alter table public.execution_runs
  add constraint execution_runs_status_check
  check (
    status in (
      'queued', 'running', 'done', 'failed', 'timed_out', 'cancelled',
      'paused', 'stalled'
    )
  );

alter table public.execution_runs
  drop constraint if exists execution_runs_stage_check;
alter table public.execution_runs
  add constraint execution_runs_stage_check
  check (
    stage in (
      'provision', 'seed', 'apply', 'install', 'build', 'typecheck',
      'plan', 'work', 'collect'
    )
  );

-- `paused` holds a live sandbox, so it must hold the one-active slot too.
drop index if exists public.execution_runs_one_active_per_owner;
create unique index if not exists execution_runs_one_active_per_owner
  on public.execution_runs (owner)
  where status in ('queued', 'running', 'paused');

create table if not exists public.execution_commands (
  id          bigserial primary key,
  run_id      uuid not null references public.execution_runs(id) on delete cascade,
  owner       uuid not null references auth.users(id) on delete cascade,
  seq         integer not null,
  at          timestamptz not null default now(),
  purpose     text not null,
  command     text not null,
  cwd         text,
  exit_code   integer,
  duration_ms integer,
  output_tail text not null default '',
  truncated   boolean not null default false,
  timed_out   boolean not null default false,
  unique (run_id, seq)
);

create index if not exists execution_commands_run_idx
  on public.execution_commands (run_id, seq);

alter table public.execution_commands enable row level security;

drop policy if exists "execution_commands: owner reads" on public.execution_commands;
create policy "execution_commands: owner reads"
  on public.execution_commands for select to authenticated
  using (auth.uid() = owner);

grant select on public.execution_commands to authenticated;

-- The agent's conversation, kept between ticks. Service role only: it is
-- working state, not a user-facing artefact. The command ledger is what a
-- reader sees.
create table if not exists public.mission_messages (
  id      bigserial primary key,
  run_id  uuid not null references public.execution_runs(id) on delete cascade,
  seq     integer not null,
  message jsonb not null,
  unique (run_id, seq)
);

create index if not exists mission_messages_run_idx
  on public.mission_messages (run_id, seq);

alter table public.mission_messages enable row level security;

revoke all on public.mission_messages from anon, authenticated;
