-- The database half of the admin kill switch.
--
-- `OPENMI_ADMIN_PANEL` lives in the host's environment, which Postgres cannot
-- read. The app mirrors it into the single row below, and `is_admin()` consults
-- that row — so "off" is enforced inside the database and not only inside
-- Next.js. That matters for exactly one case: a stolen admin token calling the
-- admin RPCs straight against PostgREST, where no page, action or middleware of
-- ours is involved.
--
-- One authority, not seven: every admin function already begins with
-- `if not public.is_admin() then raise …`, so making `is_admin()` false closes
-- all of them at once. Nothing else has to be edited to keep this honest.

create table if not exists public.admin_control (
  id boolean primary key default true,
  disabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint admin_control_single_row check (id)
);

insert into public.admin_control (id, disabled)
values (true, false)
on conflict (id) do nothing;

alter table public.admin_control enable row level security;

-- No policies, exactly like `admin_users`: the row is read through the
-- security-definer helper and written by the service role only.
revoke all on public.admin_control from public, anon, authenticated;

create or replace function public.admin_panel_disabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select c.disabled from public.admin_control c where c.id), false);
$$;

revoke all on function public.admin_panel_disabled() from public, anon, authenticated;

/**
 * The mirror write. Service role only: a browser must not be able to turn the
 * panel back on, which is the whole point of putting the switch in the host's
 * environment rather than in the product.
 */
create or replace function public.admin_set_disabled(p_disabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_control (id, disabled, updated_at)
  values (true, coalesce(p_disabled, false), now())
  on conflict (id) do update
    set disabled = excluded.disabled,
        updated_at = now();

  return coalesce(p_disabled, false);
end;
$$;

revoke all on function public.admin_set_disabled(boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on public.admin_control to service_role;
    grant execute on function public.admin_set_disabled(boolean) to service_role;
  end if;
end $$;

-- The redefinition is the enforcement. `disabled` short-circuits before the
-- role table is even read, so a row left behind in `admin_users` grants nothing
-- while the switch is off, and the switch cannot be undone from a session: the
-- setter is not executable by `authenticated`.
create or replace function public.is_admin(p_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.admin_panel_disabled() then false
    else exists (
      select 1
        from public.admin_users a
       where a.user_id = coalesce(p_user, auth.uid())
    )
  end;
$$;

revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
