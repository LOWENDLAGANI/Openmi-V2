-- A run that nothing is going to finish must not hold the account hostage.
--
-- `runs_one_active_per_owner` is a unique index over ('queued','running'). Every
-- new run is therefore refused while any leftover row sits in it — and a row
-- left by a worker that crashed, or by a deployment with no worker running at
-- all, sits there forever: `reapStaleRuns` only looked at `running` rows whose
-- heartbeat was older than twenty minutes, so a `queued` row was never settled.
--
-- Age is the only evidence available without a worker registry, so both bounds
-- are generous:
--   * a queued run older than twenty minutes was never picked up (a full
--     fifteen-minute run, plus the queue behind it, fits inside twenty);
--   * a running run silent for five minutes is dead: a live worker refreshes
--     its heartbeat every few seconds.
--
-- Called with the service role, for one named owner, by the routes that are
-- about to queue work for that owner. A stalled row is settled, never deleted,
-- so the run still appears in history and its sandbox is swept as usual.

create or replace function public.settle_stalled_runs(p_owner uuid)
returns setof public.runs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_owner is null then
    return;
  end if;

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
       (r.status = 'queued' and r.created_at < now() - interval '20 minutes')
       or (
         r.status = 'running'
         and coalesce(r.heartbeat_at, r.started_at, r.created_at) < now() - interval '5 minutes'
       )
     )
  returning r.*;
end;
$$;

revoke all on function public.settle_stalled_runs(uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.settle_stalled_runs(uuid) to service_role;
  end if;
end $$;

-- ── Stop works on a queued run too ───────────────────────────────────────────
--
-- A queued run has no worker to read `cancel_requested`, so the flag alone left
-- the row in the one-live-run index: the chat could not be stopped, and the next
-- message was refused. Settle it on the spot; a running run keeps the flag and
-- stops at its next step boundary, as before.

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
     set cancel_requested = true,
         status = case when status = 'queued' then 'cancelled' else status end,
         stop_reason = case when status = 'queued' then 'user' else stop_reason end,
         ended_at = case when status = 'queued' then now() else ended_at end
   where id = p_run
     and owner = p_owner
     and status in ('queued', 'running');

  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;
