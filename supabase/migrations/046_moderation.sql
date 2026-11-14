-- Moderation: risk signals, and the ban that follows one.
--
-- Two things an operator needs in an incident, neither of which existed:
--
--   1. a place where the app records the things that look wrong — an attempt to
--      reach a cloud metadata address from a sandbox, a rate limit tripped over
--      and over, a second run started while one is live;
--   2. a way to stop an account, today, without deleting it: `profiles.banned_at`
--      plus an optional expiry.
--
-- A ban is enforced in three places, deliberately: the session resolves to
-- `banned` so no page or route can act for the account; `claim_next_run` skips a
-- banned owner so a queued run cannot start; and banning cancels the runs that
-- are already live. The role row stays, the data stays, and lifting the ban
-- restores everything.

alter table public.profiles
  add column if not exists banned_at timestamptz,
  add column if not exists ban_expires_at timestamptz,
  add column if not exists ban_reason text,
  add column if not exists banned_by uuid references auth.users(id) on delete set null;

create table if not exists public.risk_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  -- Snapshotted at write time: the panel shows who it was even after a rename,
  -- and a signal about a deleted account still reads as a sentence.
  email       text,
  handle      text,
  kind        text not null,
  severity    text not null check (severity in ('low', 'medium', 'high', 'critical')),
  summary     text not null,
  detail      jsonb not null default '{}'::jsonb,
  route       text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution  text
);

create index if not exists risk_events_recent_idx
  on public.risk_events (created_at desc);

create index if not exists risk_events_user_idx
  on public.risk_events (user_id, created_at desc);

create index if not exists risk_events_open_idx
  on public.risk_events (created_at desc)
  where resolved_at is null;

alter table public.risk_events enable row level security;

-- No policies. The app writes with the service role; the panel reads with the
-- service role behind `requireAdmin()`. A signed-in account cannot read its own
-- signals, because knowing what tripped the alarm is a hint for the next try.
revoke all on public.risk_events from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on public.risk_events to service_role;
  end if;
end $$;

-- ── Is this account stopped? ─────────────────────────────────────────────────

create or replace function public.is_banned(p_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = coalesce(p_user, auth.uid())
       and p.banned_at is not null
       and (p.ban_expires_at is null or p.ban_expires_at > now())
  );
$$;

revoke all on function public.is_banned(uuid) from public, anon;
grant execute on function public.is_banned(uuid) to authenticated;

-- ── The operator's side ──────────────────────────────────────────────────────

create or replace function public.admin_ban_user(
  p_user uuid,
  p_reason text,
  p_hours integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  -- An operator locking themselves out is never the intended click, and the
  -- panel is the only way back in.
  if p_user = auth.uid() then
    raise exception 'an operator cannot ban their own account' using errcode = '22023';
  end if;

  if v_reason = '' then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  update public.profiles
     set banned_at = now(),
         ban_expires_at = case
           when p_hours is null then null
           else now() + make_interval(hours => greatest(p_hours, 1))
         end,
         ban_reason = v_reason,
         banned_by = auth.uid()
   where id = p_user;

  if not found then
    raise exception 'no such account' using errcode = 'P0002';
  end if;

  -- A ban that leaves work running is not a ban. Cancellation is checked at the
  -- next step boundary, so the tool in flight still finishes cleanly.
  update public.runs
     set cancel_requested = true
   where owner = p_user
     and status in ('queued', 'running');
end;
$$;

create or replace function public.admin_unban_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  update public.profiles
     set banned_at = null,
         ban_expires_at = null,
         ban_reason = null,
         banned_by = null
   where id = p_user;

  if not found then
    raise exception 'no such account' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_resolve_risk(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;

  update public.risk_events
     set resolved_at = now(),
         resolved_by = auth.uid(),
         resolution = left(coalesce(nullif(btrim(p_note), ''), 'looked at and closed'), 500)
   where id = p_id
     and resolved_at is null;

  if not found then
    raise exception 'that signal is gone or already resolved' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_ban_user(uuid, text, integer) from public, anon;
revoke all on function public.admin_unban_user(uuid) from public, anon;
revoke all on function public.admin_resolve_risk(uuid, text) from public, anon;
grant execute on function public.admin_ban_user(uuid, text, integer) to authenticated;
grant execute on function public.admin_unban_user(uuid) to authenticated;
grant execute on function public.admin_resolve_risk(uuid, text) to authenticated;

-- ── A banned owner's queue entry is not claimable ────────────────────────────
--
-- The session check stops the browser. This stops the worker: a run queued
-- before the ban must not start after it, whether or not the operator's ban
-- found it in time.

create or replace function public.claim_next_run(p_worker text)
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
     order by r.created_at
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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_next_run(text) to service_role;
  end if;
end $$;

revoke all on function public.claim_next_run(text) from public;
