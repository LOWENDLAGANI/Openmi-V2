-- Phase 7: Dew.
--
-- One balance, one ledger. Every change to `profiles.dew_balance` writes a
-- `dew_transactions` row in the same transaction, so `sum(amount)` always equals
-- the cached balance. The trial credit is a ledger row at signup, not an
-- unrecorded default.
--
-- An hour costs DEW_PER_HOUR = 3, charged once when a session starts. The price
-- is not a parameter of any function: `start_hour_session(model, repo)` cannot
-- be asked for a cheaper hour. `hour_sessions.owner` is the primary key, so two
-- concurrent starts cannot create two rows; an advisory lock serialises the
-- charge itself.
--
-- The daily allowance tops the balance up to 10 Dew (15 once the account has
-- bought a pack). It never mints Dew on a day that is not behind the account's
-- local date, so a clock that steps backwards refills nothing.
--
-- Invite codes are attributed by the signup trigger, reward both sides once,
-- and stop rewarding an inviter after 10 attributed accounts.
--
-- Refunds are one per session, fixed at the original price. Three paths reach
-- it: a provider failure, an abort before the first token, and an operator
-- adjustment (which is service-role only).

alter table public.profiles
  add column if not exists dew_balance numeric(12, 3) not null default 5
    check (dew_balance >= 0),
  add column if not exists dew_day date,
  add column if not exists has_paid boolean not null default false,
  add column if not exists invite_code text,
  add column if not exists invited_by uuid references auth.users(id) on delete set null,
  add column if not exists invite_rewarded boolean not null default false;

create unique index if not exists profiles_invite_code_idx
  on public.profiles (invite_code)
  where invite_code is not null;

create index if not exists profiles_invited_by_idx
  on public.profiles (invited_by);

update public.profiles
   set invite_code = substr(md5(id::text), 1, 8)
 where invite_code is null;

create table if not exists public.hour_sessions (
  owner uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null default gen_random_uuid() unique,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  model text,
  repo_full_name text,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.hour_sessions enable row level security;

drop policy if exists "hour_sessions: owner reads" on public.hour_sessions;
create policy "hour_sessions: owner reads"
  on public.hour_sessions for select to authenticated
  using (owner = auth.uid());

revoke all on public.hour_sessions from anon, authenticated;
grant select on public.hour_sessions to authenticated;

create table if not exists public.dew_transactions (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  kind text not null
    check (kind in ('trial', 'daily', 'session', 'refund', 'invite', 'topup', 'adjustment')),
  amount numeric(12, 3) not null check (amount <> 0),
  balance_after numeric(12, 3) not null check (balance_after >= 0),
  session_id uuid,
  chat_id uuid references public.chats(id) on delete set null,
  reference text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists dew_transactions_owner_created_idx
  on public.dew_transactions (owner, created_at desc);

create index if not exists dew_transactions_session_idx
  on public.dew_transactions (session_id);

-- One refund per paid hour, enforced by the database rather than by the caller.
create unique index if not exists dew_transactions_one_refund_per_session
  on public.dew_transactions (session_id)
  where kind = 'refund' and session_id is not null;

alter table public.dew_transactions enable row level security;

drop policy if exists "dew_transactions: owner reads" on public.dew_transactions;
create policy "dew_transactions: owner reads"
  on public.dew_transactions for select to authenticated
  using (owner = auth.uid());

revoke all on public.dew_transactions from anon, authenticated;
grant select on public.dew_transactions to authenticated;

-- Existing accounts get the same trial row a new signup gets, so the ledger
-- explains the whole balance rather than most of it.
insert into public.dew_transactions (owner, kind, amount, balance_after, reference)
select p.id, 'trial', 5, 5, 'migration'
  from public.profiles p
 where not exists (
   select 1 from public.dew_transactions t where t.owner = p.id
 );

create table if not exists public.dew_codes (
  code text primary key,
  dew_amount numeric(12, 3) not null check (dew_amount > 0),
  kind text not null default 'topup' check (kind in ('topup', 'operator')),
  note text,
  created_at timestamptz not null default now(),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz
);

alter table public.dew_codes enable row level security;
-- No client policy: codes are issued by an operator with the service role and
-- redeemed through the function below, which never returns an unredeemed code's
-- contents or lets a client list the table.
revoke all on public.dew_codes from anon, authenticated;

/**
 * Tops a balance up to the daily allowance when the account's local day has
 * advanced. Returns the balance either way.
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

  v_allowance := case when v_paid then 15 else 10 end;

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
 * Starts an hour if there is not one running, and charges exactly 3 Dew.
 * No amount argument exists on purpose.
 */
create or replace function public.start_hour_session(
  p_model text,
  p_repo text default null
)
returns table (
  session_id uuid,
  started boolean,
  expires_at timestamptz,
  balance numeric,
  price numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance numeric;
  v_session public.hour_sessions;
begin
  if v_uid is null then
    raise exception 'dew: not signed in' using errcode = '28000';
  end if;

  -- One charge at a time per account. The primary key stops duplicate rows;
  -- this stops duplicate charges.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  perform public.refill_daily_dew(v_uid);

  select h.* into v_session
    from public.hour_sessions h
   where h.owner = v_uid
     and h.expires_at > now();

  if found then
    select dew_balance into v_balance from public.profiles where id = v_uid;
    return query select v_session.session_id, false, v_session.expires_at, v_balance, 3::numeric;
    return;
  end if;

  select dew_balance into v_balance
    from public.profiles
   where id = v_uid
   for update;

  if v_balance < 3 then
    raise exception 'dew: insufficient balance' using errcode = 'P0001';
  end if;

  v_balance := v_balance - 3;

  update public.profiles set dew_balance = v_balance where id = v_uid;

  insert into public.hour_sessions
    (owner, started_at, expires_at, model, repo_full_name, refunded_at)
  values
    (v_uid, now(), now() + interval '1 hour', p_model, p_repo, null)
  on conflict (owner) do update
    set session_id = gen_random_uuid(),
        started_at = now(),
        expires_at = now() + interval '1 hour',
        model = excluded.model,
        repo_full_name = excluded.repo_full_name,
        refunded_at = null
  returning * into v_session;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, session_id, reference)
  values
    (v_uid, 'session', -3, v_balance, v_session.session_id, p_model);

  return query select v_session.session_id, true, v_session.expires_at, v_balance, 3::numeric;
end;
$$;

revoke all on function public.start_hour_session(text, text) from public, anon;
grant execute on function public.start_hour_session(text, text) to authenticated;

/** Refunds one session, once, at the price it was charged. */
create or replace function public.refund_hour_session(
  p_session_id uuid,
  p_reason text default 'refund'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_started timestamptz;
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'dew: not signed in' using errcode = '28000';
  end if;

  select owner, started_at into v_owner, v_started
    from public.hour_sessions
   where session_id = p_session_id
   for update;

  if not found or v_owner <> v_uid then
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
     set dew_balance = dew_balance + 3
   where id = v_uid
   returning dew_balance into v_balance;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, session_id, reference)
  values
    (v_uid, 'refund', 3, v_balance, p_session_id, left(coalesce(p_reason, 'refund'), 200));

  return v_balance;
end;
$$;

revoke all on function public.refund_hour_session(uuid, text) from public, anon;
grant execute on function public.refund_hour_session(uuid, text) to authenticated;

/** Redeems an operator-issued code, once. */
create or replace function public.redeem_dew_code(p_code text)
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
  if v_uid is null then
    raise exception 'dew: not signed in' using errcode = '28000';
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
     set redeemed_by = v_uid,
         redeemed_at = now()
   where code = v_code.code;

  update public.profiles
     set dew_balance = dew_balance + v_code.dew_amount,
         has_paid = case when v_code.kind = 'topup' then true else has_paid end
   where id = v_uid
   returning dew_balance into v_balance;

  v_ledger_kind := case when v_code.kind = 'topup' then 'topup' else 'adjustment' end;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, reference, note)
  values
    (v_uid, v_ledger_kind, v_code.dew_amount, v_balance, v_code.code, 'redeemed code');

  return query select v_code.dew_amount, v_balance, v_code.kind;
end;
$$;

revoke all on function public.redeem_dew_code(text) from public, anon;
grant execute on function public.redeem_dew_code(text) to authenticated;

/**
 * Operator correction. Service-role only: no grant to anon or authenticated.
 * This is the third refund path, and it can never take a balance below zero.
 */
create or replace function public.operator_adjust_dew(
  p_owner uuid,
  p_amount numeric,
  p_reason text default 'operator correction'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if p_amount = 0 then
    raise exception 'adjustment: amount is zero' using errcode = '22023';
  end if;

  select dew_balance into v_balance
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

  update public.profiles set dew_balance = v_balance where id = p_owner;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, reference)
  values
    (p_owner, 'adjustment', p_amount, v_balance, left(coalesce(p_reason, 'operator correction'), 200));

  return v_balance;
end;
$$;

revoke all on function public.operator_adjust_dew(uuid, numeric, text) from public, anon, authenticated;

/**
 * Signup: profile, invite code, trial ledger row and invite attribution.
 *
 * A bad or exhausted invite code still creates the account; it simply does not
 * attribute or reward. Rewards are recorded once per invitee, and an inviter
 * stops earning after 10 attributed accounts.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  select dew_balance into v_balance from public.profiles where id = new.id;

  insert into public.dew_transactions (owner, kind, amount, balance_after, reference)
  values (new.id, 'trial', 5, v_balance, 'signup');

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
           set dew_balance = dew_balance + 5
         where id = v_inviter
         returning dew_balance into v_inviter_balance;

        insert into public.dew_transactions
          (owner, kind, amount, balance_after, reference)
        values
          (v_inviter, 'invite', 5, v_inviter_balance, new.id::text);

        update public.profiles
           set dew_balance = dew_balance + 5
         where id = new.id
         returning dew_balance into v_balance;

        insert into public.dew_transactions
          (owner, kind, amount, balance_after, reference)
        values
          (new.id, 'invite', 5, v_balance, v_inviter::text);
      end if;
    end if;
  end if;

  return new;
end;
$$;
