-- Daily allowance: six Dew for a free account, fifteen once a top-up has been
-- redeemed. The refill still settles at local midnight in the account's own
-- timezone and still never refills on a day ahead of that date.
--
-- Recreated rather than patched with a script so the deployed function and the
-- repository agree exactly; the body is otherwise unchanged from 008.

create or replace function public.refill_daily_dew(p_owner uuid default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := coalesce(p_owner, v_uid);
  v_tz text;
  v_today date;
  v_day date;
  v_balance numeric;
  v_paid boolean;
  v_allowance numeric;
  v_delta numeric;
begin
  if v_owner is null then
    raise exception 'dew: no account' using errcode = '28000';
  end if;

  if v_uid is not null and v_uid <> v_owner then
    raise exception 'dew: not your balance' using errcode = '42501';
  end if;

  select timezone, dew_day, dew_balance, has_paid
    into v_tz, v_day, v_balance, v_paid
    from public.profiles
   where id = v_owner
   for update;

  if not found then
    raise exception 'dew: no profile' using errcode = 'P0002';
  end if;

  begin
    v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
  exception when others then
    -- An unset or invalid zone falls back to UTC rather than blocking the
    -- account's balance.
    v_today := (now() at time zone 'UTC')::date;
  end;

  -- A day that is not behind today never refills. This is the clock-backwards
  -- guard: `dew_day` ahead of the local date is left alone.
  if v_day is not null and v_day >= v_today then
    return v_balance;
  end if;

  v_allowance := case when v_paid then 15 else 6 end;

  if v_day is null then
    -- First day: the allowance is added to the trial credit.
    v_delta := v_allowance;
  else
    -- Later days top up to the allowance; unused Dew is not doubled.
    v_delta := greatest(0, v_allowance - v_balance);
  end if;

  v_balance := v_balance + v_delta;

  update public.profiles
     set dew_balance = v_balance,
         dew_day = v_today
   where id = v_owner;

  if v_delta > 0 then
    insert into public.dew_transactions (owner, kind, amount, balance_after, reference)
    values (v_owner, 'daily', v_delta, v_balance, v_today::text);
  end if;

  return v_balance;
end;
$$;

revoke all on function public.refill_daily_dew(uuid) from public, anon;
grant execute on function public.refill_daily_dew(uuid) to authenticated;
