-- Chat billing modes, wallet credit and giveaway codes.
--
-- Three additions, all server-authoritative:
--
-- 1. An hour session is scoped to the chat it started in. A second chat cannot
--    silently ride it, a per-request charge refuses while one is running, and
--    ending it is an explicit act (`end_hour_session`) rather than a wait.
-- 2. `wallet_dew` is paid credit. A charge the daily balance cannot cover is
--    split between the two rather than refused, but only when the sum covers
--    it; otherwise nothing moves.
-- 3. Operators can mint giveaway codes in bulk, and read back what they issued.
--
-- The prices are functions, not parameters: no caller can ask for a cheaper
-- hour or a cheaper request. `DEW_PER_REQUEST` in lib/dew.ts documents the same
-- number, and tests/dew.test.ts reads both.

alter table public.hour_sessions
  add column if not exists chat_id uuid references public.chats(id) on delete set null;

alter table public.profiles
  add column if not exists wallet_dew numeric(12, 3) not null default 0;

alter table public.profiles
  drop constraint if exists profiles_wallet_dew_check;
alter table public.profiles
  add constraint profiles_wallet_dew_check check (wallet_dew >= 0);

alter table public.agent_turns
  add column if not exists charge_mode text not null default 'hour';

alter table public.agent_turns
  drop constraint if exists agent_turns_charge_mode_check;
alter table public.agent_turns
  add constraint agent_turns_charge_mode_check
  check (charge_mode in ('hour', 'request'));

-- A per-request charge is its own ledger kind, so a balance can be explained
-- question by question instead of hour by hour.
alter table public.dew_transactions
  drop constraint if exists dew_transactions_kind_check;
alter table public.dew_transactions
  add constraint dew_transactions_kind_check
  check (kind in (
    'trial', 'daily', 'session', 'request', 'refund', 'invite', 'topup',
    'adjustment', 'execution', 'execution_refund'
  ));

/**
 * One chat request, in Dew. A function rather than a browser value: a client
 * that sends `price: 0` is ignored because the price is never an argument.
 */
create or replace function public.model_request_dew(p_model text)
returns numeric
language sql
immutable
as $$
  -- Every model costs the same per request today. A per-model price is a
  -- change here, not a change in the prompt or the composer.
  select 2::numeric;
$$;

/**
 * Spends `p_amount` from the daily balance first, then from paid wallet credit.
 *
 * Raises `dew: insufficient balance` before writing anything when the two
 * together cannot cover the charge, so a partial debit never happens. Each
 * source writes its own ledger row: the balance row keeps the ledger summing to
 * `dew_balance`, and the wallet row says where the rest came from.
 */
create or replace function public.charge_dew_with_wallet(
  p_owner uuid,
  p_amount numeric,
  p_kind text,
  p_reference text,
  p_session_id uuid default null,
  p_chat_id uuid default null
)
returns table (
  paid_from_balance numeric,
  paid_from_wallet numeric,
  balance numeric,
  wallet numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric := round(coalesce(p_amount, 0), 3);
  v_balance numeric;
  v_wallet numeric;
  v_from_balance numeric;
  v_from_wallet numeric;
begin
  if v_amount <= 0 then
    raise exception 'dew: nothing to charge' using errcode = '22023';
  end if;

  select p.dew_balance, p.wallet_dew
    into v_balance, v_wallet
    from public.profiles p
   where p.id = p_owner
   for update;

  if not found then
    raise exception 'dew: no profile' using errcode = 'P0002';
  end if;

  v_from_balance := least(v_balance, v_amount);
  v_from_wallet := v_amount - v_from_balance;

  if v_from_wallet > v_wallet then
    raise exception 'dew: insufficient balance' using errcode = 'P0001';
  end if;

  v_balance := v_balance - v_from_balance;
  v_wallet := v_wallet - v_from_wallet;

  update public.profiles
     set dew_balance = v_balance,
         wallet_dew = v_wallet
   where id = p_owner;

  if v_from_balance > 0 then
    insert into public.dew_transactions
      (owner, kind, amount, balance_after, session_id, chat_id, reference, note)
    values
      (p_owner, p_kind, -v_from_balance, v_balance, p_session_id, p_chat_id,
       left(p_reference, 200),
       case when v_from_wallet > 0 then 'part of a split charge' else null end);
  end if;

  if v_from_wallet > 0 then
    insert into public.dew_transactions
      (owner, kind, amount, balance_after, session_id, chat_id, reference, note)
    values
      (p_owner, 'adjustment', -v_from_wallet, v_balance, p_session_id, p_chat_id,
       left(p_reference, 200), 'paid from wallet credit');
  end if;

  return query select v_from_balance, v_from_wallet, v_balance, v_wallet;
end;
$$;

revoke all on function public.charge_dew_with_wallet(
  uuid, numeric, text, text, uuid, uuid
) from public, anon, authenticated;

-- The two-argument version is replaced, not overloaded: an old call must not
-- reach an hour that ignores the chat it belongs to.
drop function if exists public.start_hour_session(text, text);

/**
 * Starts an hour if there is not one running, and charges exactly 3 Dew.
 *
 * An hour belongs to the chat that started it. A start for another chat is
 * refused with the chat that holds it, which is what the composer turns into
 * "continue there, or end it and start here". Reusing the same chat's hour is
 * free, so a conversation inside its hour never pays twice.
 */
create or replace function public.start_hour_session(
  p_model text,
  p_repo text default null,
  p_chat_id uuid default null
)
returns table (
  session_id uuid,
  started boolean,
  expires_at timestamptz,
  balance numeric,
  price numeric,
  wallet numeric,
  combined boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.hour_sessions;
  v_charged record;
begin
  if v_uid is null then
    raise exception 'dew: not signed in' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  perform public.refill_daily_dew(v_uid);

  select h.* into v_session
    from public.hour_sessions h
   where h.owner = v_uid
     and h.expires_at > now();

  if found then
    if p_chat_id is not null
       and v_session.chat_id is not null
       and v_session.chat_id <> p_chat_id then
      raise exception 'dew: hour active in %', v_session.chat_id
        using errcode = 'P0001';
    end if;

    return query
      select v_session.session_id,
             false,
             v_session.expires_at,
             p.dew_balance,
             3::numeric,
             p.wallet_dew,
             false
        from public.profiles p
       where p.id = v_uid;
    return;
  end if;

  insert into public.hour_sessions
    (owner, started_at, expires_at, model, repo_full_name, chat_id, refunded_at)
  values
    (v_uid, now(), now() + interval '1 hour', p_model, p_repo, p_chat_id, null)
  on conflict (owner) do update
    set session_id = gen_random_uuid(),
        started_at = now(),
        expires_at = now() + interval '1 hour',
        model = excluded.model,
        repo_full_name = excluded.repo_full_name,
        chat_id = excluded.chat_id,
        refunded_at = null
  returning * into v_session;

  -- Raises before committing anything if the balance and wallet cannot cover
  -- the hour; the insert above is rolled back with the exception.
  select * into v_charged
    from public.charge_dew_with_wallet(
      v_uid, 3, 'session', coalesce(p_model, 'session'),
      v_session.session_id, p_chat_id
    );

  return query
    select v_session.session_id,
           true,
           v_session.expires_at,
           v_charged.balance,
           3::numeric,
           v_charged.wallet,
           (v_charged.paid_from_wallet > 0);
end;
$$;

/**
 * One message, one charge. Refused while an hour is running, in any chat,
 * because the hour already covers it; paying twice for the same answer is the
 * exploit this check exists to prevent.
 */
create or replace function public.charge_chat_request(
  p_model text,
  p_chat_id uuid default null,
  p_repo text default null
)
returns table (
  price numeric,
  balance numeric,
  wallet numeric,
  combined boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.hour_sessions;
  v_price numeric;
  v_charged record;
begin
  if v_uid is null then
    raise exception 'dew: not signed in' using errcode = '28000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  perform public.refill_daily_dew(v_uid);

  select h.* into v_session
    from public.hour_sessions h
   where h.owner = v_uid
     and h.expires_at > now();

  if found then
    raise exception 'dew: hour active in %',
      coalesce(v_session.chat_id::text, 'another chat')
      using errcode = 'P0001';
  end if;

  v_price := public.model_request_dew(p_model);

  select * into v_charged
    from public.charge_dew_with_wallet(
      v_uid, v_price, 'request', coalesce(p_repo, 'request'), null, p_chat_id
    );

  return query
    select v_price, v_charged.balance, v_charged.wallet,
           (v_charged.paid_from_wallet > 0);
end;
$$;

/**
 * Ends the running hour, without a refund: the reader chose to stop using it.
 * The next turn starts a fresh hour at the current chat instead.
 */
create or replace function public.end_hour_session(p_chat_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rows integer := 0;
begin
  if v_uid is null then
    raise exception 'dew: not signed in' using errcode = '28000';
  end if;

  update public.hour_sessions
     set expires_at = now()
   where owner = v_uid
     and expires_at > now()
     and (p_chat_id is null or chat_id is null or chat_id = p_chat_id);

  get diagnostics v_rows = row_count;

  return v_rows > 0;
end;
$$;

/**
 * Giveaways: an operator mints a batch of codes, each redeemable once by any
 * account. Kind `operator` adds Dew without switching the account to the paid
 * allowance, so a giveaway is not a plan.
 */
create or replace function public.admin_create_dew_codes(
  p_amount numeric,
  p_count integer default 1,
  p_note text default null
)
returns table (code text, dew_amount numeric)
language plpgsql
security definer
set search_path = public
as $$
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
      insert into public.dew_codes (code, dew_amount, kind, note)
      select 'OPENMI-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)),
             v_amount,
             'operator',
             nullif(left(btrim(coalesce(p_note, '')), 200), '')
        from generate_series(1, v_count)
      on conflict (code) do nothing
      returning dew_codes.code, dew_codes.dew_amount
    )
    select made.code, made.dew_amount from made;
end;
$$;

revoke all on function public.admin_create_dew_codes(numeric, integer, text)
  from public, anon;
grant execute on function public.admin_create_dew_codes(numeric, integer, text)
  to authenticated;

/** What was issued, newest first, so a giveaway can be read back. */
create or replace function public.admin_list_dew_codes(p_limit integer default 20)
returns table (
  code text,
  dew_amount numeric,
  note text,
  created_at timestamptz,
  redeemed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  return query
    select c.code, c.dew_amount, c.note, c.created_at, c.redeemed_at
      from public.dew_codes c
     order by c.created_at desc
     limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

revoke all on function public.admin_list_dew_codes(integer) from public, anon;
grant execute on function public.admin_list_dew_codes(integer) to authenticated;

revoke all on function public.start_hour_session(text, text, uuid)
  from public, anon;
grant execute on function public.start_hour_session(text, text, uuid)
  to authenticated;

revoke all on function public.charge_chat_request(text, uuid, text)
  from public, anon;
grant execute on function public.charge_chat_request(text, uuid, text)
  to authenticated;

revoke all on function public.end_hour_session(uuid) from public, anon;
grant execute on function public.end_hour_session(uuid) to authenticated;

-- Timed passes join the one-off packs as purchasable plans.
alter table public.payment_requests
  drop constraint if exists payment_requests_plan_check;
alter table public.payment_requests
  add constraint payment_requests_plan_check
  check (plan in ('starter', 'pro', 'studio', 'pass-15', 'pass-30'));

/** Same receipt queue as 013, with the pass ids added to the allowlist. */
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

  if v_plan <> all (array['starter', 'pro', 'studio', 'pass-15', 'pass-30']) then
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
