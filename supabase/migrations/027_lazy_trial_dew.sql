-- Trial Dew is granted on first use, not at signup.
--
-- Farming accounts used to mint 5 Dew each just by existing: the signup trigger
-- paid every new row, and it could not see an address because auth.users stores
-- none. The grant therefore moves to the first chat request, where the app does
-- have the caller's IP, and it is capped per address per day.
--
-- The account still exists — this is not a signup gate. What a mass signup can
-- no longer do is turn accounts into Dew: the first address keeps its 5, the
-- rest of the farm gets 0, and the ledger records the decision either way so an
-- operator can see it.

-- The column default was the other half of the signup grant: a new profile was
-- born with 5 Dew before any ledger row existed, which is exactly the balance
-- the ledger is supposed to explain. It starts at nothing now, so a cached
-- balance is always a row. Existing rows keep theirs; a default is not a
-- backfill.
alter table public.profiles alter column dew_balance set default 0;

-- One row per account that asked for its trial, granted or refused.
create table if not exists public.trial_grants (
  owner uuid primary key references auth.users(id) on delete cascade,
  -- A keyed hash, never the address: it is enough to count a household and not
  -- enough to retain where anyone was.
  ip_hash text not null check (length(ip_hash) between 16 and 64),
  amount numeric not null check (amount >= 0),
  granted_at timestamptz not null default now()
);

create index if not exists trial_grants_ip_idx
  on public.trial_grants (ip_hash, granted_at desc);

create index if not exists trial_grants_time_idx
  on public.trial_grants (granted_at);

alter table public.trial_grants enable row level security;

-- No policy and no grant: only the function below reaches this table.
revoke all on public.trial_grants from anon, authenticated;

-- Signup now writes the profile, the invite code and the invite attribution.
-- The trial row is not written here any more; it is written by
-- `grant_trial_dew` when the account first asks for it.
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

/**
 * Grants an account its 5 Dew trial, once, and at most one address per day.
 *
 * Returns the amount granted: 5 when it was paid, 0 when this account already
 * asked or another account on the same address was paid recently. A refusal is
 * still written to `trial_grants`, so a second request is a cheap primary-key
 * hit rather than another count.
 *
 * The address is a hash supplied by the server. A caller cannot choose the
 * amount, and the cap is checked under an advisory lock on the address so two
 * simultaneous first requests cannot both be the first.
 */
create or replace function public.grant_trial_dew(p_ip_hash text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
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

revoke all on function public.grant_trial_dew(text) from public, anon;
grant execute on function public.grant_trial_dew(text) to authenticated;
