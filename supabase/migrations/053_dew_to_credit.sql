-- ── Credit, not Dew ────────────────────────────────────────────────────────
--
-- The currency is now called Credit. This migration renames every object
-- that carried the old name — the ledger, the codes, the cached balances and
-- the functions that move them — and rewrites the function bodies that
-- mentioned any of it. It is a rename, not a data change: no balance, row or
-- history is touched.
--
-- Old migrations are left exactly as they were: the ledger's checksums are
-- what tell a deployment whether a file was already applied.

-- 1. Tables.
alter table public.dew_codes rename to credit_codes;
alter table public.dew_transactions rename to credit_transactions;

-- 2. Columns.
alter table public.credit_codes rename column dew_amount to credit_amount;
alter table public.execution_runs rename column charged_dew to charged_credit;
alter table public.execution_runs rename column reserved_dew to reserved_credit;
alter table public.payment_requests rename column dew_granted to credit_granted;
alter table public.profiles rename column dew_balance to credit_balance;
alter table public.profiles rename column dew_day to credit_day;
alter table public.profiles rename column wallet_dew to wallet_credit;
alter table public.runs rename column dew_session_id to credit_session_id;

-- 3. Indexes and constraints, so nothing still reads old.
alter index public.dew_codes_pkey rename to credit_codes_pkey;
alter index public.dew_transactions_one_execution_per_run rename to credit_transactions_one_execution_per_run;
alter index public.dew_transactions_one_execution_refund rename to credit_transactions_one_execution_refund;
alter index public.dew_transactions_one_refund_per_session rename to credit_transactions_one_refund_per_session;
alter index public.dew_transactions_owner_created_idx rename to credit_transactions_owner_created_idx;
alter index public.dew_transactions_pkey rename to credit_transactions_pkey;
alter index public.dew_transactions_session_idx rename to credit_transactions_session_idx;
alter table public.credit_codes rename constraint dew_codes_dew_amount_check to credit_codes_credit_amount_check;
alter table public.credit_codes rename constraint dew_codes_kind_check to credit_codes_kind_check;
alter table public.credit_codes rename constraint dew_codes_redeemed_by_fkey to credit_codes_redeemed_by_fkey;
alter table public.credit_transactions rename constraint dew_transactions_amount_check to credit_transactions_amount_check;
alter table public.credit_transactions rename constraint dew_transactions_balance_after_check to credit_transactions_balance_after_check;
alter table public.credit_transactions rename constraint dew_transactions_chat_id_fkey to credit_transactions_chat_id_fkey;
alter table public.credit_transactions rename constraint dew_transactions_kind_check to credit_transactions_kind_check;
alter table public.credit_transactions rename constraint dew_transactions_owner_fkey to credit_transactions_owner_fkey;
alter table public.payment_requests rename constraint payment_requests_dew_granted_check to payment_requests_credit_granted_check;
alter table public.profiles rename constraint profiles_dew_balance_check to profiles_credit_balance_check;
alter table public.profiles rename constraint profiles_wallet_dew_check to profiles_wallet_credit_check;

-- 4. Functions.
--
-- A renamed function is created under its new name and the old one dropped,
-- because Postgres cannot rename a parameter in place. A function whose
-- name did not mention the currency is replaced and keeps the grants it
-- already had.

drop function if exists public.admin_create_dew_codes(p_amount numeric, p_count integer, p_note text);
CREATE OR REPLACE FUNCTION public.admin_create_credit_codes(p_amount numeric, p_count integer DEFAULT 1, p_note text DEFAULT NULL::text)
 RETURNS TABLE(code text, credit_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric := round(coalesce(p_amount, 0), 3);
  v_count integer := greatest(1, least(coalesce(p_count, 1), 50));
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  if v_amount <= 0 then
    raise exception 'giveaway: enter a positive amount' using errcode = '22023';
  end if;

  return query
    with made as (
      insert into public.credit_codes (code, credit_amount, kind, note)
      select 'OPENMI-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)),
             v_amount,
             'operator',
             nullif(left(btrim(coalesce(p_note, '')), 200), '')
        from generate_series(1, v_count)
      on conflict (code) do nothing
      returning credit_codes.code, credit_codes.credit_amount
    )
    select made.code, made.credit_amount from made;
end;
$function$;
revoke all on function public.admin_create_credit_codes(p_amount numeric, p_count integer, p_note text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.admin_create_credit_codes(p_amount numeric, p_count integer, p_note text) to authenticated;
  end if;
end $$;

drop function if exists public.admin_dew_held();
CREATE OR REPLACE FUNCTION public.admin_credit_held()
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total numeric;
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  select coalesce(sum(credit_balance + wallet_credit), 0)
    into v_total
    from public.profiles;

  return v_total;
end;
$function$;
revoke all on function public.admin_credit_held() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.admin_credit_held() to authenticated;
  end if;
end $$;

drop function if exists public.admin_grant_dew(p_email text, p_amount numeric, p_reason text);
CREATE OR REPLACE FUNCTION public.admin_grant_credit(p_email text, p_amount numeric, p_reason text DEFAULT 'operator top-up'::text)
 RETURNS TABLE(user_id uuid, balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_target uuid;
  v_balance numeric;
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'admin: amount is zero' using errcode = '22023';
  end if;

  select u.id into v_target
    from auth.users u
   where lower(u.email) = lower(btrim(coalesce(p_email, '')))
   limit 1;

  if v_target is null then
    raise exception 'admin: no account with that email' using errcode = 'P0002';
  end if;

  update public.profiles
     set wallet_credit = wallet_credit + p_amount
   where id = v_target
  returning wallet_credit into v_balance;

  if not found then
    raise exception 'admin: account has no profile' using errcode = 'P0002';
  end if;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, reference, note)
  values
    (v_target,
     case when p_amount > 0 then 'topup' else 'adjustment' end,
     p_amount, v_balance,
     left(coalesce(nullif(btrim(p_reason), ''), 'operator top-up'), 200),
     'admin');

  return query select v_target, v_balance;
end;
$function$;
revoke all on function public.admin_grant_credit(p_email text, p_amount numeric, p_reason text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.admin_grant_credit(p_email text, p_amount numeric, p_reason text) to authenticated;
  end if;
end $$;

drop function if exists public.admin_list_dew_codes(p_limit integer);
CREATE OR REPLACE FUNCTION public.admin_list_credit_codes(p_limit integer DEFAULT 20)
 RETURNS TABLE(code text, credit_amount numeric, note text, created_at timestamp with time zone, redeemed_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  return query
    select c.code, c.credit_amount, c.note, c.created_at, c.redeemed_at
      from public.credit_codes c
     order by c.created_at desc
     limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$function$;
revoke all on function public.admin_list_credit_codes(p_limit integer) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.admin_list_credit_codes(p_limit integer) to authenticated;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.charge_chat_request(p_model text, p_chat_id uuid DEFAULT NULL::uuid, p_repo text DEFAULT NULL::text)
 RETURNS TABLE(price numeric, balance numeric, wallet numeric, combined boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_session public.hour_sessions;
  v_price numeric;
  v_charged record;
begin
  if v_uid is null then
    raise exception 'credit: not signed in' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  perform public.refill_daily_credit(v_uid);

  select h.* into v_session
    from public.hour_sessions h
   where h.owner = v_uid
     and h.expires_at > now();

  if found then
    raise exception 'credit: hour active in %',
      coalesce(v_session.chat_id::text, 'another chat')
      using errcode = 'P0001';
  end if;

  v_price := public.model_request_credit(p_model);

  select * into v_charged
    from public.charge_credit_with_wallet(
      v_uid, v_price, 'request', coalesce(p_repo, 'request'), null, p_chat_id
    );

  return query
    select v_price, v_charged.balance, v_charged.wallet,
           (v_charged.paid_from_wallet > 0);
end;
$function$;

drop function if exists public.charge_dew_with_wallet(p_owner uuid, p_amount numeric, p_kind text, p_reference text, p_session_id uuid, p_chat_id uuid);
CREATE OR REPLACE FUNCTION public.charge_credit_with_wallet(p_owner uuid, p_amount numeric, p_kind text, p_reference text, p_session_id uuid DEFAULT NULL::uuid, p_chat_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(paid_from_balance numeric, paid_from_wallet numeric, balance numeric, wallet numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric := round(coalesce(p_amount, 0), 3);
  v_balance numeric;
  v_wallet numeric;
  v_from_balance numeric;
  v_from_wallet numeric;
begin
  if v_amount <= 0 then
    raise exception 'credit: nothing to charge' using errcode = '22023';
  end if;

  select p.credit_balance, p.wallet_credit
    into v_balance, v_wallet
    from public.profiles p
   where p.id = p_owner
   for update;

  if not found then
    raise exception 'credit: no profile' using errcode = 'P0002';
  end if;

  v_from_balance := least(v_balance, v_amount);
  v_from_wallet := v_amount - v_from_balance;

  if v_from_wallet > v_wallet then
    raise exception 'credit: insufficient balance' using errcode = 'P0001';
  end if;

  v_balance := v_balance - v_from_balance;
  v_wallet := v_wallet - v_from_wallet;

  update public.profiles
     set credit_balance = v_balance,
         wallet_credit = v_wallet
   where id = p_owner;

  if v_from_balance > 0 then
    insert into public.credit_transactions
      (owner, kind, amount, balance_after, session_id, chat_id, reference, note)
    values
      (p_owner, p_kind, -v_from_balance, v_balance, p_session_id, p_chat_id,
       left(p_reference, 200),
       case when v_from_wallet > 0 then 'part of a split charge' else null end);
  end if;

  if v_from_wallet > 0 then
    insert into public.credit_transactions
      (owner, kind, amount, balance_after, session_id, chat_id, reference, note)
    values
      (p_owner, 'adjustment', -v_from_wallet, v_balance, p_session_id, p_chat_id,
       left(p_reference, 200), 'paid from wallet credit');
  end if;

  return query select v_from_balance, v_from_wallet, v_balance, v_wallet;
end;
$function$;
revoke all on function public.charge_credit_with_wallet(p_owner uuid, p_amount numeric, p_kind text, p_reference text, p_session_id uuid, p_chat_id uuid) from public;

drop function if exists public.deduct_own_dew(p_amount numeric, p_reason text);
CREATE OR REPLACE FUNCTION public.deduct_own_credit(p_amount numeric, p_reason text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_amount numeric;
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'credit: not signed in' using errcode = '28000';
  end if;

  v_amount := round(greatest(0, least(coalesce(p_amount, 0), 100000)));

  if v_amount <= 0 then
    raise exception 'credit: enter a positive amount' using errcode = '22023';
  end if;

  select credit_balance
    into v_balance
    from public.profiles
   where id = v_uid
   for update;

  if not found then
    raise exception 'credit: no profile' using errcode = 'P0002';
  end if;

  if v_balance < v_amount then
    raise exception 'credit: not enough balance' using errcode = 'P0001';
  end if;

  v_balance := v_balance - v_amount;

  update public.profiles
     set credit_balance = v_balance
   where id = v_uid;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, reference, note)
  values
    (v_uid, 'adjustment', -v_amount, v_balance, 'self',
     left(coalesce(p_reason, 'deducted by the account'), 200));

  return v_balance;
end;
$function$;
revoke all on function public.deduct_own_credit(p_amount numeric, p_reason text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.deduct_own_credit(p_amount numeric, p_reason text) to authenticated;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.end_hour_session(p_chat_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_rows integer := 0;
begin
  if v_uid is null then
    raise exception 'credit: not signed in' using errcode = '28000';
  end if;

  update public.hour_sessions
     set expires_at = now()
   where owner = v_uid
     and expires_at > now()
     and (p_chat_id is null or chat_id is null or chat_id = p_chat_id);

  get diagnostics v_rows = row_count;

  return v_rows > 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_paid_only_hour()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    raise exception 'credit: model requires a paid pass' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

drop function if exists public.execution_reserve_dew(p_owner uuid, p_run_id uuid, p_amount numeric);
CREATE OR REPLACE FUNCTION public.execution_reserve_credit(p_owner uuid, p_run_id uuid, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_amount numeric := round(coalesce(p_amount, 0), 3);
  v_balance numeric;
begin
  if p_owner is null or p_run_id is null then
    raise exception 'credit: a reservation needs an account and a run' using errcode = '22023';
  end if;

  if v_uid is not null and v_uid <> p_owner then
    raise exception 'credit: not your balance' using errcode = '42501';
  end if;

  if v_amount <= 0 then
    raise exception 'credit: a reservation must be positive' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('credit:' || p_owner::text));

  select wallet_credit
    into v_balance
    from public.profiles
   where id = p_owner
   for update;

  if not found then
    raise exception 'credit: no profile' using errcode = 'P0002';
  end if;

  if v_balance < v_amount then
    raise exception 'credit: insufficient balance' using errcode = 'P0001';
  end if;

  v_balance := v_balance - v_amount;

  update public.profiles
     set wallet_credit = v_balance
   where id = p_owner;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, reference, note)
  values
    (p_owner, 'execution', -v_amount, v_balance, p_run_id::text,
     'sandbox run reserved');

  return v_balance;
end;
$function$;
revoke all on function public.execution_reserve_credit(p_owner uuid, p_run_id uuid, p_amount numeric) from public;

drop function if exists public.execution_settle_dew(p_owner uuid, p_run_id uuid, p_charged numeric);
CREATE OR REPLACE FUNCTION public.execution_settle_credit(p_owner uuid, p_run_id uuid, p_charged numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_reserved numeric;
  v_charged numeric := round(coalesce(p_charged, 0), 3);
  v_refund numeric;
  v_balance numeric;
begin
  if p_owner is null or p_run_id is null then
    raise exception 'credit: a settlement needs an account and a run' using errcode = '22023';
  end if;

  if v_uid is not null and v_uid <> p_owner then
    raise exception 'credit: not your balance' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('credit:' || p_owner::text));

  select -amount
    into v_reserved
    from public.credit_transactions
   where owner = p_owner
     and kind = 'execution'
     and reference = p_run_id::text;

  if not found then
    raise exception 'credit: no reservation for this run' using errcode = 'P0002';
  end if;

  select wallet_credit
    into v_balance
    from public.profiles
   where id = p_owner
   for update;

  if not found then
    raise exception 'credit: no profile' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.credit_transactions
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
       set wallet_credit = v_balance
     where id = p_owner;

    insert into public.credit_transactions
      (owner, kind, amount, balance_after, reference, note)
    values
      (p_owner, 'execution_refund', v_refund, v_balance, p_run_id::text,
       'unused sandbox time returned');
  end if;

  return v_balance;
end;
$function$;
revoke all on function public.execution_settle_credit(p_owner uuid, p_run_id uuid, p_charged numeric) from public;

drop function if exists public.grant_trial_dew(p_ip_hash text);
CREATE OR REPLACE FUNCTION public.grant_trial_credit(p_ip_hash text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_ip text := left(btrim(coalesce(p_ip_hash, '')), 64);
  v_amount numeric := 5;
  v_recent integer;
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'credit: not signed in' using errcode = '28000';
  end if;

  if length(v_ip) < 16 then
    raise exception 'credit: an address hash is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_ip, 0));

  -- Once per account, for the life of the account.
  if exists (select 1 from public.trial_grants where owner = v_uid) then
    return 0;
  end if;

  -- One paid trial per address per day. A household, an office or a mobile
  -- carrier NAT still gets its first account paid; the address is not asked to
  -- prove anything beyond that.
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
     set wallet_credit = wallet_credit + v_amount
   where id = v_uid
   returning wallet_credit into v_balance;

  if v_balance is null then
    raise exception 'credit: no profile' using errcode = 'P0002';
  end if;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, reference)
  values (v_uid, 'trial', v_amount, v_balance, 'first-request');

  insert into public.trial_grants (owner, ip_hash, amount)
  values (v_uid, v_ip, v_amount);

  return v_amount;
end;
$function$;
revoke all on function public.grant_trial_credit(p_ip_hash text) from public;

drop function if exists public.grant_trial_dew(p_owner uuid, p_ip_hash text);
CREATE OR REPLACE FUNCTION public.grant_trial_credit(p_owner uuid, p_ip_hash text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := p_owner;
  v_ip text := left(btrim(coalesce(p_ip_hash, '')), 64);
  v_amount numeric := 5;
  v_recent integer;
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'credit: not signed in' using errcode = '28000';
  end if;

  if length(v_ip) < 16 then
    raise exception 'credit: an address hash is required' using errcode = '22023';
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
     set wallet_credit = wallet_credit + v_amount
   where id = v_uid
   returning wallet_credit into v_balance;

  if v_balance is null then
    raise exception 'credit: no profile' using errcode = 'P0002';
  end if;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, reference)
  values (v_uid, 'trial', v_amount, v_balance, 'first-request');

  insert into public.trial_grants (owner, ip_hash, amount)
  values (v_uid, v_ip, v_amount);

  return v_amount;
end;
$function$;
revoke all on function public.grant_trial_credit(p_owner uuid, p_ip_hash text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.grant_trial_credit(p_owner uuid, p_ip_hash text) to service_role;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inviter uuid;
  v_code text;
  v_inviter_balance numeric;
  v_balance numeric;
begin
  insert into public.profiles (id, email, handle, invite_code)
  values (
    new.id,
    new.email,
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    substr(md5(new.id::text), 1, 8)
  )
  on conflict (id) do nothing;

  v_code := upper(btrim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));

  if v_code <> '' then
    select id into v_inviter
      from public.profiles
     where upper(invite_code) = v_code;

    if v_inviter is not null and v_inviter <> new.id then
      -- Serialise the cap check for one inviter, so two simultaneous signups
      -- cannot both see nine rewarded accounts and both reward.
      perform pg_advisory_xact_lock(hashtextextended(v_inviter::text, 0));

      if (
        select count(*)
          from public.profiles p
         where p.invited_by = v_inviter
           and p.invite_rewarded
      ) < 10 then
        update public.profiles
           set invited_by = v_inviter,
               invite_rewarded = true
         where id = new.id;

        update public.profiles
           set wallet_credit = wallet_credit + 5
         where id = v_inviter
         returning wallet_credit into v_inviter_balance;

        insert into public.credit_transactions
          (owner, kind, amount, balance_after, reference)
        values
          (v_inviter, 'invite', 5, v_inviter_balance, new.id::text);

        update public.profiles
           set wallet_credit = wallet_credit + 5
         where id = new.id
         returning wallet_credit into v_balance;

        insert into public.credit_transactions
          (owner, kind, amount, balance_after, reference)
        values
          (new.id, 'invite', 5, v_balance, v_inviter::text);
      end if;
    end if;
  end if;

  return new;
end;
$function$;

drop function if exists public.model_hour_dew(p_model text);
CREATE OR REPLACE FUNCTION public.model_hour_credit(p_model text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case lower(btrim(coalesce(p_model, '')))
    when 'auto' then 0::numeric
    when 'deepseek-flash' then 3::numeric
    when 'claude-haiku' then 3::numeric
    when 'gpt-6-luna' then 3::numeric
    -- A model this function has not been taught costs the catalogue default.
    else 3::numeric
  end;
$function$;
revoke all on function public.model_hour_credit(p_model text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.model_hour_credit(p_model text) to authenticated;
  end if;
end $$;

drop function if exists public.model_request_dew(p_model text);
CREATE OR REPLACE FUNCTION public.model_request_credit(p_model text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  -- Every model costs the same per request today. A per-model price is a
  -- change here, not a change in the prompt or the composer.
  select 2::numeric;
$function$;
revoke all on function public.model_request_credit(p_model text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant execute on function public.model_request_credit(p_model text) to anon;
  end if;
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.model_request_credit(p_model text) to authenticated;
  end if;
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.model_request_credit(p_model text) to service_role;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.openmi_schema_probe()
 RETURNS TABLE(kind text, object text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with required(kind, object) as (
    values
      ('table', 'folders'),
      ('table', 'chats'),
      ('table', 'messages'),
      ('table', 'github_connections'),
      ('table', 'agent_turns'),
      ('table', 'changesets'),
      ('table', 'changeset_files'),
      ('table', 'hour_sessions'),
      ('table', 'credit_transactions'),
      ('table', 'credit_codes'),
      ('table', 'rate_limits'),
      ('table', 'admin_users'),
      ('table', 'payment_requests'),
      ('function', 'append_message'),
      ('function', 'consume_agent_step'),
      ('function', 'refill_daily_credit'),
      ('function', 'start_hour_session'),
      ('function', 'refund_hour_session'),
      ('function', 'redeem_credit_code'),
      ('function', 'rate_limit_hit'),
      ('function', 'openmi_migration_ledger'),
      ('function', 'is_admin'),
      ('function', 'submit_payment_request'),
      ('function', 'review_payment_request'),
      ('function', 'admin_grant_credit'),
      ('function', 'admin_set_admin')
  )
  select r.kind, r.object
    from required r
   where not exists (
           select 1
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where r.kind = 'table'
              and n.nspname = 'public'
              and c.relname = r.object
              and c.relkind in ('r', 'p')
         )
     and not exists (
           select 1
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where r.kind = 'function'
              and n.nspname = 'public'
              and p.proname = r.object
         )
   order by r.kind, r.object;
$function$;

drop function if exists public.operator_adjust_dew(p_owner uuid, p_amount numeric, p_reason text);
CREATE OR REPLACE FUNCTION public.operator_adjust_credit(p_owner uuid, p_amount numeric, p_reason text DEFAULT 'operator correction'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance numeric;
begin
  if p_amount = 0 then
    raise exception 'adjustment: amount is zero' using errcode = '22023';
  end if;

  select wallet_credit into v_balance
    from public.profiles
   where id = p_owner
   for update;

  if not found then
    raise exception 'adjustment: no profile' using errcode = 'P0002';
  end if;

  v_balance := v_balance + p_amount;

  if v_balance < 0 then
    raise exception 'adjustment: balance cannot go negative' using errcode = '22003';
  end if;

  update public.profiles set wallet_credit = v_balance where id = p_owner;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, reference)
  values
    (p_owner, 'adjustment', p_amount, v_balance, left(coalesce(p_reason, 'operator correction'), 200));

  return v_balance;
end;
$function$;
revoke all on function public.operator_adjust_credit(p_owner uuid, p_amount numeric, p_reason text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.operator_adjust_credit(p_owner uuid, p_amount numeric, p_reason text) to service_role;
  end if;
end $$;

drop function if exists public.redeem_dew_code(p_code text);
CREATE OR REPLACE FUNCTION public.redeem_credit_code(p_code text)
 RETURNS TABLE(amount numeric, balance numeric, kind text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_code public.credit_codes;
  v_balance numeric;
  v_ledger_kind text;
begin
  if v_uid is null then
    raise exception 'credit: not signed in' using errcode = '28000';
  end if;

  select * into v_code
    from public.credit_codes
   where code = upper(btrim(p_code))
   for update;

  if not found then
    raise exception 'code: not found' using errcode = 'P0002';
  end if;

  if v_code.redeemed_by is not null then
    raise exception 'code: already redeemed' using errcode = 'P0001';
  end if;

  update public.credit_codes
     set redeemed_by = v_uid,
         redeemed_at = now()
   where code = v_code.code;

  update public.profiles
     set wallet_credit = wallet_credit + v_code.credit_amount,
         has_paid = case when v_code.kind = 'topup' then true else has_paid end
   where id = v_uid
   returning wallet_credit into v_balance;

  v_ledger_kind := case when v_code.kind = 'topup' then 'topup' else 'adjustment' end;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, reference, note)
  values
    (v_uid, v_ledger_kind, v_code.credit_amount, v_balance, v_code.code, 'redeemed code');

  return query select v_code.credit_amount, v_balance, v_code.kind;
end;
$function$;
revoke all on function public.redeem_credit_code(p_code text) from public;

drop function if exists public.redeem_dew_code(p_owner uuid, p_code text);
CREATE OR REPLACE FUNCTION public.redeem_credit_code(p_owner uuid, p_code text)
 RETURNS TABLE(amount numeric, balance numeric, kind text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_code public.credit_codes;
  v_balance numeric;
  v_ledger_kind text;
begin
  if p_owner is null then
    raise exception 'credit: an account is required' using errcode = '28000';
  end if;

  -- The service role (no auth.uid) still names the owner explicitly; a signed-in
  -- caller may only redeem into their own account.
  if v_uid is not null and v_uid <> p_owner then
    raise exception 'credit: not your balance' using errcode = '42501';
  end if;

  select * into v_code
    from public.credit_codes
   where code = upper(btrim(p_code))
   for update;

  if not found then
    raise exception 'code: not found' using errcode = 'P0002';
  end if;

  if v_code.redeemed_by is not null then
    raise exception 'code: already redeemed' using errcode = 'P0001';
  end if;

  update public.credit_codes
     set redeemed_by = p_owner,
         redeemed_at = now()
   where code = v_code.code;

  update public.profiles
     set wallet_credit = wallet_credit + v_code.credit_amount
   where id = p_owner
   returning wallet_credit into v_balance;

  if v_balance is null then
    raise exception 'credit: no profile' using errcode = 'P0002';
  end if;

  v_ledger_kind := case when v_code.kind = 'topup' then 'topup' else 'adjustment' end;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, reference, note)
  values
    (p_owner, v_ledger_kind, v_code.credit_amount, v_balance, v_code.code, 'redeemed code');

  return query select v_code.credit_amount, v_balance, v_code.kind;
end;
$function$;
revoke all on function public.redeem_credit_code(p_owner uuid, p_code text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.redeem_credit_code(p_owner uuid, p_code text) to authenticated;
  end if;
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.redeem_credit_code(p_owner uuid, p_code text) to service_role;
  end if;
end $$;

drop function if exists public.refill_daily_dew(p_owner uuid);
CREATE OR REPLACE FUNCTION public.refill_daily_credit(p_owner uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    raise exception 'credit: no account' using errcode = '28000';
  end if;

  if v_uid is not null and v_uid <> v_owner then
    raise exception 'credit: not your balance' using errcode = '42501';
  end if;

  select timezone, credit_day, credit_balance, paid_until
    into v_tz, v_day, v_balance, v_paid_until
    from public.profiles
   where id = v_owner
   for update;

  if not found then
    raise exception 'credit: no profile' using errcode = 'P0002';
  end if;

  begin
    v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
  exception when others then
    -- An unset or invalid zone falls back to UTC rather than blocking the
    -- account's balance.
    v_today := (now() at time zone 'UTC')::date;
  end;

  -- A day that is not behind today never refills. This is the clock-backwards
  -- guard: `credit_day` ahead of the local date is left alone.
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
    -- Later days top up to the allowance; unused Credit is not doubled.
    v_delta := greatest(0, v_allowance - v_balance);
  end if;

  v_balance := v_balance + v_delta;

  update public.profiles
     set credit_balance = v_balance,
         credit_day = v_today
   where id = v_owner;

  if v_delta > 0 then
    insert into public.credit_transactions (owner, kind, amount, balance_after, reference)
    values (v_owner, 'daily', v_delta, v_balance, v_today::text);
  end if;

  return v_balance;
end;
$function$;
revoke all on function public.refill_daily_credit(p_owner uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.refill_daily_credit(p_owner uuid) to authenticated;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.refund_hour_session(p_owner uuid, p_session_id uuid, p_reason text DEFAULT 'refund'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_started timestamptz;
  v_amount numeric;
  v_balance numeric;
begin
  if p_owner is null or p_session_id is null then
    raise exception 'credit: a refund needs an account and a session' using errcode = '22023';
  end if;

  select owner, started_at, coalesce(price, public.model_hour_credit(model))
    into v_owner, v_started, v_amount
    from public.hour_sessions
   where session_id = p_session_id
   for update;

  if not found or v_owner <> p_owner then
    raise exception 'credit: no such session' using errcode = 'P0002';
  end if;

  if v_started < now() - interval '1 hour' then
    raise exception 'credit: refund window closed' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.credit_transactions
     where session_id = p_session_id and kind = 'refund'
  ) then
    raise exception 'credit: already refunded' using errcode = 'P0001';
  end if;

  update public.hour_sessions set refunded_at = now() where session_id = p_session_id;

  -- A free hour has nothing to give back; the mark above is its whole refund.
  if v_amount <= 0 then
    select p.wallet_credit into v_balance
      from public.profiles p
     where p.id = p_owner;
    return v_balance;
  end if;

  update public.profiles
     set wallet_credit = wallet_credit + v_amount
   where id = p_owner
   returning wallet_credit into v_balance;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, session_id, reference)
  values
    (p_owner, 'refund', v_amount, v_balance, p_session_id,
     left(coalesce(p_reason, 'refund'), 200));

  return v_balance;
end;
$function$;

CREATE OR REPLACE FUNCTION public.refund_hour_session(p_session_id uuid, p_reason text DEFAULT 'refund'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_started timestamptz;
  v_amount numeric;
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'credit: not signed in' using errcode = '28000';
  end if;

  select owner, started_at, coalesce(price, public.model_hour_credit(model))
    into v_owner, v_started, v_amount
    from public.hour_sessions
   where session_id = p_session_id
   for update;

  if not found or v_owner <> v_uid then
    raise exception 'credit: no such session' using errcode = 'P0002';
  end if;

  if v_started < now() - interval '1 hour' then
    raise exception 'credit: refund window closed' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.credit_transactions
     where session_id = p_session_id and kind = 'refund'
  ) then
    raise exception 'credit: already refunded' using errcode = 'P0001';
  end if;

  update public.hour_sessions set refunded_at = now() where session_id = p_session_id;

  -- A free hour has nothing to give back; the mark above is its whole refund.
  if v_amount <= 0 then
    select p.wallet_credit into v_balance
      from public.profiles p
     where p.id = v_uid;
    return v_balance;
  end if;

  update public.profiles
     set wallet_credit = wallet_credit + v_amount
   where id = v_uid
   returning wallet_credit into v_balance;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, session_id, reference)
  values
    (v_uid, 'refund', v_amount, v_balance, p_session_id,
     left(coalesce(p_reason, 'refund'), 200));

  return v_balance;
end;
$function$;

drop function if exists public.review_payment_request(p_id uuid, p_decision text, p_note text, p_dew integer);
CREATE OR REPLACE FUNCTION public.review_payment_request(p_id uuid, p_decision text, p_note text DEFAULT NULL::text, p_credit integer DEFAULT 0)
 RETURNS TABLE(status text, balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_row public.payment_requests;
  v_balance numeric;
  v_credit integer;
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

  v_credit := greatest(0, least(coalesce(p_credit, 0), 100000));
  v_days := case v_row.plan
    when 'pass-15' then 15
    when 'pass-30' then 30
    else 0
  end;

  if v_decision = 'approved' then
    update public.profiles
       set wallet_credit = wallet_credit + v_credit,
           has_paid = has_paid or v_days > 0,
           paid_until = case
             when v_days > 0 then
               greatest(coalesce(paid_until, now()), now())
                 + make_interval(days => v_days)
             else paid_until
           end
     where id = v_row.owner
    returning wallet_credit into v_balance;

    if not found then
      raise exception 'review: no profile for the request'
        using errcode = 'P0002';
    end if;

    if v_credit > 0 then
      insert into public.credit_transactions
        (owner, kind, amount, balance_after, reference, note)
      values
        (v_row.owner, 'topup', v_credit, v_balance, 'receipt:' || v_row.id,
         left(coalesce(nullif(btrim(p_note), ''), 'approved receipt'), 200));
    end if;
  else
    select credit_balance into v_balance
      from public.profiles
     where id = v_row.owner;
  end if;

  update public.payment_requests
     set status = v_decision,
         credit_granted = case when v_decision = 'approved' then v_credit else null end,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_id;

  return query select v_decision, v_balance;
end;
$function$;
revoke all on function public.review_payment_request(p_id uuid, p_decision text, p_note text, p_credit integer) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.review_payment_request(p_id uuid, p_decision text, p_note text, p_credit integer) to authenticated;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.start_hour_session(p_model text, p_repo text DEFAULT NULL::text, p_chat_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(session_id uuid, started boolean, expires_at timestamp with time zone, balance numeric, price numeric, wallet numeric, combined boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_session public.hour_sessions;
  v_charged record;
  v_price numeric := public.model_hour_credit(p_model);
begin
  if v_uid is null then
    raise exception 'credit: not signed in' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  perform public.refill_daily_credit(v_uid);

  select h.* into v_session
    from public.hour_sessions h
   where h.owner = v_uid
     and h.expires_at > now();

  if found then
    if p_chat_id is not null
       and v_session.chat_id is not null
       and v_session.chat_id <> p_chat_id then
      raise exception 'credit: hour active in %', v_session.chat_id
        using errcode = 'P0001';
    end if;

    -- The model is part of what was paid for, so switching mid-hour is an
    -- explicit act: end this hour, then start one on the other model.
    if v_session.model is distinct from p_model then
      raise exception 'credit: hour on model %',
        coalesce(v_session.model, 'another model')
        using errcode = 'P0001';
    end if;

    return query
      select v_session.session_id,
             false,
             v_session.expires_at,
             p.credit_balance,
             coalesce(v_session.price, v_price),
             p.wallet_credit,
             false
        from public.profiles p
       where p.id = v_uid;
    return;
  end if;

  insert into public.hour_sessions
    (owner, started_at, expires_at, model, repo_full_name, chat_id, price,
     refunded_at)
  values
    (v_uid, now(), now() + interval '1 hour', p_model, p_repo, p_chat_id,
     v_price, null)
  on conflict (owner) do update
    set session_id = gen_random_uuid(),
        started_at = now(),
        expires_at = now() + interval '1 hour',
        model = excluded.model,
        repo_full_name = excluded.repo_full_name,
        chat_id = excluded.chat_id,
        price = excluded.price,
        refunded_at = null
  returning * into v_session;

  if v_price > 0 then
    -- Raises before committing anything if the balance and wallet cannot cover
    -- the hour; the insert above is rolled back with the exception.
    select * into v_charged
      from public.charge_credit_with_wallet(
        v_uid, v_price, 'session', coalesce(p_model, 'session'),
        v_session.session_id, p_chat_id
      );
  else
    -- A free hour moves nothing, so there is nothing to charge and no ledger
    -- row to write: `credit_transactions.amount <> 0` is not a formality. The
    -- balances are read so the caller gets the same shape either way.
    select p.credit_balance as balance,
           p.wallet_credit as wallet,
           0::numeric as paid_from_wallet
      into v_charged
      from public.profiles p
     where p.id = v_uid;
  end if;

  return query
    select v_session.session_id,
           true,
           v_session.expires_at,
           v_charged.balance,
           v_price,
           v_charged.wallet,
           (v_charged.paid_from_wallet > 0);
end;
$function$;
