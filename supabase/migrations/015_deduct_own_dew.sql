-- A signed-in account may give Dew back.
--
-- This is the only self-service balance change besides redeeming a code. It is
-- deliberately one-directional: there is no positive-amount path here, because a
-- top-up with neither a receipt nor a code would mint credit from nothing.
-- `operator_adjust_dew` still moves a balance either way, and it remains
-- service-role only.
--
-- The ledger row is `adjustment` with a negative amount, so `sum(amount)` still
-- equals the cached balance exactly as it does for every other change.

create or replace function public.deduct_own_dew(
  p_amount numeric,
  p_reason text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric;
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'dew: not signed in' using errcode = '28000';
  end if;

  v_amount := round(greatest(0, least(coalesce(p_amount, 0), 100000)));

  if v_amount <= 0 then
    raise exception 'dew: enter a positive amount' using errcode = '22023';
  end if;

  select dew_balance
    into v_balance
    from public.profiles
   where id = v_uid
   for update;

  if not found then
    raise exception 'dew: no profile' using errcode = 'P0002';
  end if;

  if v_balance < v_amount then
    raise exception 'dew: not enough balance' using errcode = 'P0001';
  end if;

  v_balance := v_balance - v_amount;

  update public.profiles
     set dew_balance = v_balance
   where id = v_uid;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, reference, note)
  values
    (v_uid, 'adjustment', -v_amount, v_balance, 'self',
     left(coalesce(p_reason, 'deducted by the account'), 200));

  return v_balance;
end;
$$;

revoke all on function public.deduct_own_dew(numeric, text) from public, anon;
grant execute on function public.deduct_own_dew(numeric, text) to authenticated;
