-- Close two holes in the payment path.
--
-- `redeem_dew_code(p_owner, p_code)` is executable by any signed-in account and
-- trusted the owner id it was handed. The app calls it with the service role
-- and an explicit owner, but a browser can call the same function with its own
-- session and somebody else's id, crediting a code into that account. A user
-- session may now only redeem into its own balance.
--
-- Receipts were also replayable. The same transaction reference could be
-- submitted repeatedly (up to the pending cap), so one payment could become
-- several passes, and any amount was accepted even for a RM36 plan. A
-- reference is now single-use across the queue, and a receipt below the plan's
-- price is refused before a row exists.
--
-- The plan prices here mirror `PLANS` in lib/billing/plans.ts, and the days in
-- 038 mirror the same catalogue; a test reads both migrations and fails if a
-- price or duration drifts.

create or replace function public.redeem_dew_code(
  p_owner uuid,
  p_code text
)
returns table (amount numeric, balance numeric, kind text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code public.dew_codes;
  v_balance numeric;
  v_ledger_kind text;
begin
  if p_owner is null then
    raise exception 'dew: an account is required' using errcode = '28000';
  end if;

  -- The service role (no auth.uid) still names the owner explicitly; a signed-in
  -- caller may only redeem into their own account.
  if v_uid is not null and v_uid <> p_owner then
    raise exception 'dew: not your balance' using errcode = '42501';
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
  v_price numeric;
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

  v_price := case v_plan
    when 'pass-15' then 18
    when 'pass-30' then 36
  end;

  if coalesce(p_amount, 0) < v_price then
    raise exception 'payment: the amount is below the plan price'
      using errcode = '22023';
  end if;

  -- One reference is one payment. Two concurrent submissions with the same
  -- reference serialize here, so both cannot pass the duplicate check.
  perform pg_advisory_xact_lock(hashtext(lower(v_reference)));

  if exists (
    select 1
      from public.payment_requests r
     where lower(r.reference) = lower(v_reference)
       and r.status <> 'rejected'
  ) then
    raise exception 'payment: that reference was already submitted'
      using errcode = 'P0001';
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
