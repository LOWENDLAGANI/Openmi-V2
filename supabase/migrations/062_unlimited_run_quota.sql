-- ── Unlimited daily run quota, granted by an operator ───────────────────────
--
-- A run is held to a daily budget per account (`RUN_DAILY_RUNS` runs and
-- `RUN_DAILY_TOKENS` tokens per UTC day, in lib/runs/limits.ts). Admins are
-- exempt from both. This flag lets an operator give the same exemption to any
-- other account, and take it back, from the admin panel.
--
-- What it does not lift: the one-live-run concurrency rule and the per-run caps
-- (steps, tokens, wall clock). Those protect the worker, not the budget.
--
-- `authenticated` can only update `timezone` and `handle` on profiles (013), so
-- a member cannot set this column on themselves; the function below is the
-- only writer, and it re-checks `is_admin()`.

alter table public.profiles
  add column if not exists unlimited_runs boolean not null default false;

create or replace function public.admin_set_unlimited(
  p_user uuid,
  p_enabled boolean
)
returns table (user_id uuid, unlimited_runs boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_enabled boolean;
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  if p_user is null then
    raise exception 'unlimited: an account is required' using errcode = '22023';
  end if;

  update public.profiles p
     set unlimited_runs = coalesce(p_enabled, false)
   where p.id = p_user
  returning p.id, p.unlimited_runs into v_target, v_enabled;

  if not found then
    raise exception 'unlimited: no account with that id' using errcode = 'P0002';
  end if;

  return query select v_target, v_enabled;
end;
$$;

revoke all on function public.admin_set_unlimited(uuid, boolean) from public, anon;
grant execute on function public.admin_set_unlimited(uuid, boolean) to authenticated;
