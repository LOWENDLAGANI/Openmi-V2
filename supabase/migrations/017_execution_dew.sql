-- Sandbox runs pay for their minutes.
--
-- Two movements, both against the same ledger every other charge uses:
--
--   execution         a reservation, taken before the sandbox is created
--   execution_refund  the unused part of that reservation, returned on settle
--
-- The balance is never edited without a row, so `sum(amount)` still equals
-- `profiles.dew_balance` for every account. `reference` carries the run id, and
-- two partial unique indexes make a second reservation or a second refund for
-- the same run impossible at the database level rather than in the caller.
--
-- Both functions take `p_owner` and are service-role only. The run path is a
-- server task: it proves ownership with the session, then moves Dew with the
-- service role. A signed-in account cannot call these, which is why neither has
-- a grant below.

alter table public.dew_transactions
  drop constraint if exists dew_transactions_kind_check;

alter table public.dew_transactions
  add constraint dew_transactions_kind_check
  check (
    kind in (
      'trial', 'daily', 'session', 'refund', 'invite', 'topup', 'adjustment',
      'execution', 'execution_refund'
    )
  );

create unique index if not exists dew_transactions_one_execution_per_run
  on public.dew_transactions (reference)
  where kind = 'execution' and reference is not null;

create unique index if not exists dew_transactions_one_execution_refund
  on public.dew_transactions (reference)
  where kind = 'execution_refund' and reference is not null;

/**
 * Takes the reservation. Refuses before the sandbox exists when the balance
 * cannot cover it, which is the whole point of reserving rather than charging
 * afterwards: a run that cannot be paid for never starts.
 */
create or replace function public.execution_reserve_dew(
  p_owner uuid,
  p_run_id uuid,
  p_amount numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_amount numeric := round(coalesce(p_amount, 0), 3);
  v_balance numeric;
begin
  if p_owner is null or p_run_id is null then
    raise exception 'dew: a reservation needs an account and a run' using errcode = '22023';
  end if;

  if v_uid is not null and v_uid <> p_owner then
    raise exception 'dew: not your balance' using errcode = '42501';
  end if;

  if v_amount <= 0 then
    raise exception 'dew: a reservation must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('dew:' || p_owner::text));

  select dew_balance
    into v_balance
    from public.profiles
   where id = p_owner
   for update;

  if not found then
    raise exception 'dew: no profile' using errcode = 'P0002';
  end if;

  if v_balance < v_amount then
    raise exception 'dew: insufficient balance' using errcode = 'P0001';
  end if;

  v_balance := v_balance - v_amount;

  update public.profiles
     set dew_balance = v_balance
   where id = p_owner;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, reference, note)
  values
    (p_owner, 'execution', -v_amount, v_balance, p_run_id::text,
     'sandbox run reserved');

  return v_balance;
end;
$$;

/**
 * Settles a reservation against the minutes the run actually lasted.
 *
 * `p_charged` is capped at the reservation here as well as in the caller: the
 * database is the last place that can refuse to charge more than was reserved.
 * A second settle for the same run returns the balance unchanged and writes no
 * second row, so a cancel that races the runner cannot refund twice.
 */
create or replace function public.execution_settle_dew(
  p_owner uuid,
  p_run_id uuid,
  p_charged numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reserved numeric;
  v_charged numeric := round(coalesce(p_charged, 0), 3);
  v_refund numeric;
  v_balance numeric;
begin
  if p_owner is null or p_run_id is null then
    raise exception 'dew: a settlement needs an account and a run' using errcode = '22023';
  end if;

  if v_uid is not null and v_uid <> p_owner then
    raise exception 'dew: not your balance' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('dew:' || p_owner::text));

  select -amount
    into v_reserved
    from public.dew_transactions
   where owner = p_owner
     and kind = 'execution'
     and reference = p_run_id::text;

  if not found then
    raise exception 'dew: no reservation for this run' using errcode = 'P0002';
  end if;

  select dew_balance
    into v_balance
    from public.profiles
   where id = p_owner
   for update;

  if not found then
    raise exception 'dew: no profile' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.dew_transactions
     where owner = p_owner
       and kind = 'execution_refund'
       and reference = p_run_id::text
  ) then
    return v_balance;
  end if;

  if v_charged < 0 then
    v_charged := 0;
  end if;

  if v_charged > v_reserved then
    v_charged := v_reserved;
  end if;

  v_refund := round(v_reserved - v_charged, 3);

  if v_refund > 0 then
    v_balance := v_balance + v_refund;

    update public.profiles
       set dew_balance = v_balance
     where id = p_owner;

    insert into public.dew_transactions
      (owner, kind, amount, balance_after, reference, note)
    values
      (p_owner, 'execution_refund', v_refund, v_balance, p_run_id::text,
       'unused sandbox time returned');
  end if;

  return v_balance;
end;
$$;

revoke all on function public.execution_reserve_dew(uuid, uuid, numeric)
  from public, anon, authenticated;
revoke all on function public.execution_settle_dew(uuid, uuid, numeric)
  from public, anon, authenticated;
