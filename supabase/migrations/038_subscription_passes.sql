-- A paid plan is a window, not a badge.
--
-- `has_paid` recorded that an account had bought something, and every approved
-- receipt raised the daily allowance permanently — including the one-off Dew
-- packs, which are no longer sold. A "15-day pass" therefore never ended.
--
-- `paid_until` is now the entitlement: the daily allowance is 15 only while it
-- is in the future. `has_paid` stays as history ("a pass was bought"), never as
-- the thing that decides an allowance.

alter table public.profiles
  add column if not exists paid_until timestamptz;

comment on column public.profiles.paid_until is
  'End of the paid daily allowance. Entitlement is paid_until > now(); has_paid records that a pass was ever bought.';

-- Existing paid accounts keep a fair window: the end of their last approved
-- pass when that is later, otherwise one month from this migration. Nobody is
-- downgraded mid-month by the change. The guard makes the second pass a no-op.
update public.profiles p
   set paid_until = greatest(
     coalesce(
       (
         select max(
                  r.decided_at + case r.plan
                    when 'pass-15' then interval '15 days'
                    when 'pass-30' then interval '30 days'
                    else interval '0'
                  end
                )
           from public.payment_requests r
          where r.owner = p.id
            and r.status = 'approved'
            and r.plan in ('pass-15', 'pass-30')
       ),
       now() + interval '30 days'
     ),
     now()
   )
 where p.has_paid = true
   and p.paid_until is null;

/**
 * Tops a balance up to the daily allowance when the account's local day has
 * turned. The allowance is 15 only while a pass is active; otherwise it is 6.
 * The clock-backwards guard and the first-day rule are unchanged from 014.
 */
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
  v_paid_until timestamptz;
  v_allowance numeric;
  v_delta numeric;
begin
  if v_owner is null then
    raise exception 'dew: no account' using errcode = '28000';
  end if;

  if v_uid is not null and v_uid <> v_owner then
    raise exception 'dew: not your balance' using errcode = '42501';
  end if;

  select timezone, dew_day, dew_balance, paid_until
    into v_tz, v_day, v_balance, v_paid_until
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

  v_allowance := case
    when v_paid_until is not null and v_paid_until > now() then 15
    else 6
  end;

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

/**
 * Approves or rejects one pending request.
 *
 * Approval grants the Dew the operator named and extends the paid window by the
 * days the plan sells: from now, or from the current end when a pass is already
 * running, so buying early never shortens what was already paid for. A legacy
 * one-off pack row has no days and grants Dew only.
 */
create or replace function public.review_payment_request(
  p_id uuid,
  p_decision text,
  p_note text default null,
  p_dew integer default 0
)
returns table (status text, balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_row public.payment_requests;
  v_balance numeric;
  v_dew integer;
  v_days integer;
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  if v_decision <> all (array['approved', 'rejected']) then
    raise exception 'review: choose approved or rejected'
      using errcode = '22023';
  end if;

  select * into v_row
    from public.payment_requests
   where id = p_id
   for update;

  if not found then
    raise exception 'review: request not found' using errcode = 'P0002';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'review: already reviewed' using errcode = 'P0001';
  end if;

  v_dew := greatest(0, least(coalesce(p_dew, 0), 100000));
  v_days := case v_row.plan
    when 'pass-15' then 15
    when 'pass-30' then 30
    else 0
  end;

  if v_decision = 'approved' then
    update public.profiles
       set dew_balance = dew_balance + v_dew,
           has_paid = has_paid or v_days > 0,
           paid_until = case
             when v_days > 0 then
               greatest(coalesce(paid_until, now()), now())
                 + make_interval(days => v_days)
             else paid_until
           end
     where id = v_row.owner
    returning dew_balance into v_balance;

    if not found then
      raise exception 'review: no profile for the request'
        using errcode = 'P0002';
    end if;

    if v_dew > 0 then
      insert into public.dew_transactions
        (owner, kind, amount, balance_after, reference, note)
      values
        (v_row.owner, 'topup', v_dew, v_balance, 'receipt:' || v_row.id,
         left(coalesce(nullif(btrim(p_note), ''), 'approved receipt'), 200));
    end if;
  else
    select dew_balance into v_balance
      from public.profiles
     where id = v_row.owner;
  end if;

  update public.payment_requests
     set status = v_decision,
         dew_granted = case when v_decision = 'approved' then v_dew else null end,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_id;

  return query select v_decision, v_balance;
end;
$$;

revoke all on function public.review_payment_request(uuid, text, text, integer)
  from public, anon;
grant execute on function public.review_payment_request(uuid, text, text, integer)
  to authenticated;

/**
 * Redemption adds Dew and nothing else. A code is not a plan: under the
 * subscription model a top-up no longer flips the paid badge (and with it the
 * allowance) on for good.
 */
create or replace function public.redeem_dew_code(p_owner uuid, p_code text)
returns table (amount numeric, balance numeric, kind text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.dew_codes;
  v_balance numeric;
  v_ledger_kind text;
begin
  if p_owner is null then
    raise exception 'dew: an account is required' using errcode = '28000';
  end if;

  select * into v_code
    from public.dew_codes
   where code = upper(btrim(p_code))
   for update;

  if not found then
    raise exception 'code: not found' using errcode = 'P0002';
  end if;

  if v_code.redeemed_by is not null then
    raise exception 'code: already redeemed' using errcode = 'P0001';
  end if;

  update public.dew_codes
     set redeemed_by = p_owner,
         redeemed_at = now()
   where code = v_code.code;

  update public.profiles
     set dew_balance = dew_balance + v_code.dew_amount
   where id = p_owner
   returning dew_balance into v_balance;

  if v_balance is null then
    raise exception 'dew: no profile' using errcode = 'P0002';
  end if;

  v_ledger_kind := case when v_code.kind = 'topup' then 'topup' else 'adjustment' end;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, reference, note)
  values
    (p_owner, v_ledger_kind, v_code.dew_amount, v_balance, v_code.code, 'redeemed code');

  return query select v_code.dew_amount, v_balance, v_code.kind;
end;
$$;

revoke all on function public.redeem_dew_code(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_dew_code(uuid, text) to authenticated;

/**
 * Only the two passes can be submitted now. The table's broader constraint is
 * kept so receipts already queued under a pack name can still be reviewed;
 * nothing new can be created with one.
 */
create or replace function public.submit_payment_request(
  p_plan text,
  p_amount numeric,
  p_reference text,
  p_note text,
  p_receipt_path text,
  p_receipt_name text default null
)
returns table (id uuid, status text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text := lower(btrim(coalesce(p_plan, '')));
  v_reference text := btrim(coalesce(p_reference, ''));
  v_path text := btrim(coalesce(p_receipt_path, ''));
  v_pending integer;
  v_row public.payment_requests;
begin
  if v_uid is null then
    raise exception 'payment: not signed in' using errcode = '28000';
  end if;

  if v_plan <> all (array['pass-15', 'pass-30']) then
    raise exception 'payment: unknown plan' using errcode = '22023';
  end if;

  if v_reference = '' or length(v_reference) > 120 then
    raise exception 'payment: add the transaction reference'
      using errcode = '22023';
  end if;

  if v_path = '' or v_path not like v_uid::text || '/%' then
    raise exception 'payment: upload the receipt first'
      using errcode = '22023';
  end if;

  if coalesce(p_amount, 0) < 0 then
    raise exception 'payment: amount cannot be negative'
      using errcode = '22023';
  end if;

  select count(*) into v_pending
    from public.payment_requests r
   where r.owner = v_uid
     and r.status = 'pending';

  if v_pending >= 5 then
    raise exception 'payment: too many pending receipts'
      using errcode = 'P0001';
  end if;

  insert into public.payment_requests
    (owner, plan, amount, reference, note, receipt_path, receipt_name)
  values
    (v_uid, v_plan, coalesce(p_amount, 0), left(v_reference, 120),
     nullif(left(btrim(coalesce(p_note, '')), 500), ''),
     v_path, nullif(left(btrim(coalesce(p_receipt_name, '')), 200), ''))
  returning * into v_row;

  return query select v_row.id, v_row.status, v_row.created_at;
end;
$$;

revoke all on function public.submit_payment_request(
  text, numeric, text, text, text, text
) from public, anon;
grant execute on function public.submit_payment_request(
  text, numeric, text, text, text, text
) to authenticated;

/**
 * One aggregate for the admin panel. The panel used to sum the first 5,000
 * profile rows it could read, which silently undercounted a larger deployment
 * and left paid wallet credit out of the number.
 */
create or replace function public.admin_dew_held()
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  select coalesce(sum(dew_balance + wallet_dew), 0)
    into v_total
    from public.profiles;

  return v_total;
end;
$$;

revoke all on function public.admin_dew_held() from public, anon;
grant execute on function public.admin_dew_held() to authenticated;

/**
 * Revoking by user id, for the admin list. A row whose profile has no email
 * cannot be revoked by the email-based function, which is what the panel used
 * to send.
 */
create or replace function public.admin_set_admin_id(
  p_user_id uuid,
  p_enabled boolean
)
returns table (user_id uuid, enabled boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'admin: an account is required' using errcode = '22023';
  end if;

  if not p_enabled and p_user_id = auth.uid() then
    raise exception 'admin: you cannot remove your own access'
      using errcode = 'P0001';
  end if;

  if p_enabled then
    insert into public.admin_users (user_id, note)
    values (p_user_id, 'granted from the admin panel')
    on conflict (user_id) do nothing;
  else
    delete from public.admin_users where user_id = p_user_id;
  end if;

  return query select p_user_id, p_enabled;
end;
$$;

revoke all on function public.admin_set_admin_id(uuid, boolean) from public, anon;
grant execute on function public.admin_set_admin_id(uuid, boolean) to authenticated;
