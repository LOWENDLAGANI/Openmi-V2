-- Dew-moving functions that mint or return credit are server operations.
--
-- The browser could previously call `refund_hour_session`, `redeem_dew_code`
-- and `grant_trial_dew` directly with its own JWT. A refund credits a full hour
-- without ending the session, a code can be guessed without the app's limiter,
-- and the trial address hash is supplied by the client. Each function now takes
-- the owner as an argument and is executable only by the service role; the app
-- already has the signed-in owner and uses its server client.
--
-- The old signatures stay in the database for compatibility with already
-- serialized calls, but they are revoked from every client role.

/**
 * Refunds one session, once, at the price it was charged.
 *
 * The owner is explicit because the service role has no `auth.uid()`. The
 * session row is locked, so two refunds cannot both pass the existence check.
 */
create or replace function public.refund_hour_session(
  p_owner uuid,
  p_session_id uuid,
  p_reason text default 'refund'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_started timestamptz;
  v_amount numeric;
  v_balance numeric;
begin
  if p_owner is null or p_session_id is null then
    raise exception 'dew: a refund needs an account and a session' using errcode = '22023';
  end if;

  select owner, started_at, coalesce(price, public.model_hour_dew(model))
    into v_owner, v_started, v_amount
    from public.hour_sessions
   where session_id = p_session_id
   for update;

  if not found or v_owner <> p_owner then
    raise exception 'dew: no such session' using errcode = 'P0002';
  end if;

  if v_started < now() - interval '1 hour' then
    raise exception 'dew: refund window closed' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.dew_transactions
     where session_id = p_session_id and kind = 'refund'
  ) then
    raise exception 'dew: already refunded' using errcode = 'P0001';
  end if;

  update public.hour_sessions set refunded_at = now() where session_id = p_session_id;

  update public.profiles
     set dew_balance = dew_balance + v_amount
   where id = p_owner
   returning dew_balance into v_balance;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, session_id, reference)
  values
    (p_owner, 'refund', v_amount, v_balance, p_session_id,
     left(coalesce(p_reason, 'refund'), 200));

  return v_balance;
end;
$$;

/**
 * Redeems an operator-issued code, once, for the named account.
 *
 * The code row is locked, so a concurrent redeem cannot both spend it. The
 * function never reveals an unredeemed code it was not given.
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
     set dew_balance = dew_balance + v_code.dew_amount,
         has_paid = case when v_code.kind = 'topup' then true else has_paid end
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

/**
 * Grants an account its trial once, at most one address per day.
 *
 * The address hash is supplied by the server, not by the browser, which is why
 * this is now a service-role function. The per-account check remains the hard
 * cap; the address check is the anti-farm speed bump.
 */
create or replace function public.grant_trial_dew(p_owner uuid, p_ip_hash text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := p_owner;
  v_ip text := left(btrim(coalesce(p_ip_hash, '')), 64);
  v_amount numeric := 5;
  v_recent integer;
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'dew: not signed in' using errcode = '28000';
  end if;

  if length(v_ip) < 16 then
    raise exception 'dew: an address hash is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_ip, 0));

  if exists (select 1 from public.trial_grants where owner = v_uid) then
    return 0;
  end if;

  select count(*) into v_recent
    from public.trial_grants
   where ip_hash = v_ip
     and amount > 0
     and granted_at > now() - interval '24 hours';

  if v_recent >= 1 then
    insert into public.trial_grants (owner, ip_hash, amount)
    values (v_uid, v_ip, 0);
    return 0;
  end if;

  update public.profiles
     set dew_balance = dew_balance + v_amount
   where id = v_uid
   returning dew_balance into v_balance;

  if v_balance is null then
    raise exception 'dew: no profile' using errcode = 'P0002';
  end if;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, reference)
  values (v_uid, 'trial', v_amount, v_balance, 'first-request');

  insert into public.trial_grants (owner, ip_hash, amount)
  values (v_uid, v_ip, v_amount);

  return v_amount;
end;
$$;

revoke all on function public.refund_hour_session(uuid, text)
  from public, anon, authenticated;
revoke all on function public.refund_hour_session(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.redeem_dew_code(text)
  from public, anon, authenticated;
revoke all on function public.redeem_dew_code(uuid, text)
  from public, anon, authenticated;
revoke all on function public.grant_trial_dew(text)
  from public, anon, authenticated;
revoke all on function public.grant_trial_dew(uuid, text)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.refund_hour_session(uuid, uuid, text)
      to service_role;
    grant execute on function public.redeem_dew_code(uuid, text)
      to service_role;
    grant execute on function public.grant_trial_dew(uuid, text)
      to service_role;
  end if;
end
$$;
