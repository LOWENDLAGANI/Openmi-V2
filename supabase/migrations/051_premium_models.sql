-- One model is sold with a pass, not with Dew.
--
-- Claude Haiku 4.5 is served through Straitly (lib/models/routes.ts) and costs
-- the catalogue's hour like every other named model. What is different is who
-- may buy it: an account whose `paid_until` is still ahead. The catalogue says
-- so (`paidOnly`), the chat route refuses before it charges, and this migration
-- is the backstop for every other path that can open an hour — a mission, a
-- retried run, a caller nobody has written yet.
--
-- The gate is a trigger on `hour_sessions` rather than a fifth rewrite of
-- `start_hour_session`: the function has already been redefined four times, and
-- copying it again would make the next reader diff five bodies to find one
-- condition. `start_hour_session` rolls its upsert back on a raise, so a refusal
-- here leaves no session, no charge and no ledger row.

create or replace function public.model_requires_pass(p_model text)
returns boolean
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_model, '')))
    when 'claude-haiku' then true
    else false
  end;
$$;

comment on function public.model_requires_pass(text) is
  'Models only a live paid pass may open an hour on. Mirrors paidOnly in lib/models.ts.';

revoke all on function public.model_requires_pass(text) from public, anon;
grant execute on function public.model_requires_pass(text) to authenticated;

/**
 * Prices every catalogue model, including the paid-only one.
 *
 * The number is the same 3 Dew the hour costs everywhere; it is written out so
 * the picker and the charge cannot drift (tests/dew.test.ts reads both). This
 * replaces the 041 definition, which is the one that is live.
 */
create or replace function public.model_hour_dew(p_model text)
returns numeric
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_model, '')))
    when 'auto' then 0::numeric
    when 'deepseek-flash' then 3::numeric
    when 'claude-haiku' then 3::numeric
    -- A model this function has not been taught costs the catalogue default.
    else 3::numeric
  end;
$$;

revoke all on function public.model_hour_dew(text) from public, anon;
grant execute on function public.model_hour_dew(text) to authenticated;

/**
 * Refuses an hour on a paid-only model when the owner's pass is not live.
 *
 * `paid_until` is the entitlement (038): a pass that ended yesterday is not a
 * pass, and `has_paid` is history. An hour already open when the pass expires
 * keeps running — it was paid for before it started — because this only checks
 * the row being written.
 */
create or replace function public.enforce_paid_only_hour()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.model is null or not public.model_requires_pass(new.model) then
    return new;
  end if;

  if not exists (
    select 1
      from public.profiles p
     where p.id = new.owner
       and p.paid_until is not null
       and p.paid_until > now()
  ) then
    raise exception 'dew: model requires a paid pass' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_paid_only_hour()
  from public, anon, authenticated;

drop trigger if exists hour_sessions_enforce_pass on public.hour_sessions;
create trigger hour_sessions_enforce_pass
  before insert or update of model, owner on public.hour_sessions
  for each row execute function public.enforce_paid_only_hour();
