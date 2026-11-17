-- ── The paid path: a refund goes back where it came from, and a pass pays today
--
-- Three defects, one file.
--
-- 1. A refund was always paid into the wallet, whatever paid for the hour.
--    `charge_credit_with_wallet` spends the daily balance first and the wallet
--    only for the rest, but `refund_hour_session` added the whole price back to
--    `wallet_credit`. The wallet is paid credit: it never expires and the daily
--    refill never touches it. So a refund took renewable daily allowance and
--    turned it into permanent credit — and because the next day's refill tops the
--    balance back up, a failed turn every day banked 3 Credit a day for free.
--    A refund now reads the session's own charge rows and returns each part to
--    the bucket it came from.
--
-- 2. A refunded hour kept running. `refunded_at` was stamped but `expires_at`
--    was left alone, so a turn that failed and was refunded left its hour live
--    for the rest of the 60 minutes: the Credit came back and so did the time.
--    The refund now ends the hour, because the time it bought is being returned.
--
-- 3. A pass bought at noon did not raise that day's allowance. The daily refill
--    settles the local day once, at 6 Credit for a free account, so a member who
--    paid for "15 Credit a day" read 6 until midnight. Approval now tops today's
--    balance up to the paid allowance, using the same rule the refill uses
--    (top up to the allowance, never double).
--
-- The app calls the three-argument refund with the service role; the
-- two-argument one is kept in step so the two cannot disagree about where a
-- refund lands. Both are already revoked from every client role in 029.

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
  v_from_balance numeric := 0;
  v_from_wallet numeric := 0;
  v_balance numeric;
  v_wallet numeric;
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

  -- The refund ends the hour: the Credit returns, so the time it bought cannot
  -- stay on the account as well.
  update public.hour_sessions
     set refunded_at = now(),
         expires_at = least(expires_at, now())
   where session_id = p_session_id;

  -- A free hour has nothing to give back; the mark above is its whole refund.
  if v_amount <= 0 then
    select p.credit_balance into v_balance
      from public.profiles p
     where p.id = p_owner;
    return v_balance;
  end if;

  -- Where the hour was actually charged from: `charge_credit_with_wallet` writes
  -- one row per bucket, and both carry the session id.
  select coalesce(-sum(t.amount), 0)
    into v_from_balance
    from public.credit_transactions t
   where t.session_id = p_session_id
     and t.kind = 'session';

  select coalesce(-sum(t.amount), 0)
    into v_from_wallet
    from public.credit_transactions t
   where t.session_id = p_session_id
     and t.kind = 'adjustment'
     and t.note = 'paid from wallet credit';

  v_from_balance := least(greatest(v_from_balance, 0), v_amount);

  if v_from_balance + v_from_wallet <> v_amount then
    -- No charge rows (an hour written before the split was recorded) or a price
    -- that no longer matches them: return the price, and put anything the ledger
    -- cannot account for into the wallet, which is what this function always did.
    v_from_wallet := v_amount - v_from_balance;
  end if;

  update public.profiles
     set credit_balance = credit_balance + v_from_balance,
         wallet_credit = wallet_credit + v_from_wallet
   where id = p_owner
   returning credit_balance, wallet_credit into v_balance, v_wallet;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, session_id, reference, note)
  values
    (p_owner, 'refund', v_amount, v_balance, p_session_id,
     left(coalesce(p_reason, 'refund'), 200),
     case
       when v_from_balance > 0 and v_from_wallet > 0
         then 'returned ' || v_from_balance::text || ' to the balance and '
              || v_from_wallet::text || ' to the wallet'
       else null
     end);

  return v_balance;
end;
$$;

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
  v_amount numeric;
  v_from_balance numeric := 0;
  v_from_wallet numeric := 0;
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

  update public.hour_sessions
     set refunded_at = now(),
         expires_at = least(expires_at, now())
   where session_id = p_session_id;

  if v_amount <= 0 then
    select p.credit_balance into v_balance
      from public.profiles p
     where p.id = v_uid;
    return v_balance;
  end if;

  select coalesce(-sum(t.amount), 0)
    into v_from_balance
    from public.credit_transactions t
   where t.session_id = p_session_id
     and t.kind = 'session';

  select coalesce(-sum(t.amount), 0)
    into v_from_wallet
    from public.credit_transactions t
   where t.session_id = p_session_id
     and t.kind = 'adjustment'
     and t.note = 'paid from wallet credit';

  v_from_balance := least(greatest(v_from_balance, 0), v_amount);

  if v_from_balance + v_from_wallet <> v_amount then
    v_from_wallet := v_amount - v_from_balance;
  end if;

  update public.profiles
     set credit_balance = credit_balance + v_from_balance,
         wallet_credit = wallet_credit + v_from_wallet
   where id = v_uid
   returning credit_balance into v_balance;

  insert into public.credit_transactions
    (owner, kind, amount, balance_after, session_id, reference, note)
  values
    (v_uid, 'refund', v_amount, v_balance, p_session_id,
     left(coalesce(p_reason, 'refund'), 200),
     case
       when v_from_balance > 0 and v_from_wallet > 0
         then 'returned ' || v_from_balance::text || ' to the balance and '
              || v_from_wallet::text || ' to the wallet'
       else null
     end);

  return v_balance;
end;
$$;

-- The refund and the approval both stay server-only or admin-only: a browser
-- must not be able to return an hour to itself, and only an operator approves a
-- receipt. Re-stated here because a replaced function keeps its old grants.
revoke all on function public.refund_hour_session(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.refund_hour_session(uuid, text)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.refund_hour_session(uuid, uuid, text)
      to service_role;
  end if;
end
$$;

/**
 * Approves or rejects one pending request.
 *
 * Unchanged except for the day of purchase: approving a pass raises today's
 * allowance as well as tomorrow's. The daily refill settles a local day once, so
 * without this a member who paid at noon would read "15 Credit a day" while
 * their balance stayed at the 6 the morning refill gave them.
 */
create or replace function public.review_payment_request(
  p_id uuid,
  p_decision text,
  p_note text default null,
  p_credit integer default 0
)
returns table (status text, balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_row public.payment_requests;
  -- The returned `balance` has always been the wallet after the decision.
  v_wallet numeric;
  v_balance numeric;
  v_credit integer;
  v_days integer;
  v_tz text;
  v_today date;
  v_day date;
  v_topup numeric;
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
    returning wallet_credit, credit_balance into v_wallet, v_balance;

    if v_wallet is null then
      raise exception 'review: no profile for the request'
        using errcode = 'P0002';
    end if;

    if v_credit > 0 then
      insert into public.credit_transactions
        (owner, kind, amount, balance_after, reference, note)
      values
        (v_row.owner, 'topup', v_credit, v_wallet, 'receipt:' || v_row.id,
         left(coalesce(nullif(btrim(p_note), ''), 'approved receipt'), 200));
    end if;

    -- A pass that is live now also raises the day that is already settled. The
    -- allowance is the same 15 `refill_daily_credit` uses; the rule is the same
    -- too, a top-up to the allowance rather than a second grant, so the Credit
    -- just handed over is not doubled.
    if v_days > 0 then
      select timezone, credit_day
        into v_tz, v_day
        from public.profiles
       where id = v_row.owner;

      begin
        v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
      exception when others then
        v_today := (now() at time zone 'UTC')::date;
      end;

      -- An unsettled day needs nothing here: the next refill will settle it at
      -- the paid allowance because `paid_until` is now in the future.
      if v_day is not null and v_day >= v_today then
        v_topup := greatest(0, 15 - v_balance);

        if v_topup > 0 then
          update public.profiles
             set credit_balance = credit_balance + v_topup
           where id = v_row.owner
           returning credit_balance into v_balance;

          insert into public.credit_transactions
            (owner, kind, amount, balance_after, reference, note)
          values
            (v_row.owner, 'daily', v_topup, v_balance, v_today::text,
             'paid allowance on the day the pass was approved');
        end if;
      end if;
    end if;
  else
    select wallet_credit into v_wallet
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

  return query select v_decision, v_wallet;
end;
$$;

revoke all on function public.review_payment_request(uuid, text, text, integer)
  from public, anon;
grant execute on function public.review_payment_request(uuid, text, text, integer)
  to authenticated;

-- ── A turn no worker finished ───────────────────────────────────────────────
--
-- The loop refunds a run it saw fail. A run whose worker stopped reporting is
-- settled by the reaper instead, and that path marked it failed and kept the
-- hour: the reader paid for an answer that never came, and the Credit was gone.
--
-- The refund is best effort by design. A settle that raised — an hour older than
-- the refund window, an hour already refunded — must never leave the run stuck
-- in the one-live-run index, because that locks the account out of chatting.
-- `try_refund_hour_session` therefore swallows the refusal and reports whether
-- the Credit moved.

create or replace function public.try_refund_hour_session(
  p_owner uuid,
  p_session_id uuid,
  p_reason text default 'the turn did not finish'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_owner is null or p_session_id is null then
    return false;
  end if;

  perform public.refund_hour_session(p_owner, p_session_id, p_reason);

  return true;
exception
  when others then
    -- A closed window, an already refunded hour, a missing profile: none of
    -- these are reasons to leave a run unsettled.
    return false;
end;
$$;

revoke all on function public.try_refund_hour_session(uuid, uuid, text)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.try_refund_hour_session(uuid, uuid, text)
      to service_role;
  end if;
end
$$;

/**
 * Settles the runs nothing is going to finish, and gives back the hour each one
 * was charged for.
 *
 * Same selection rules as 047; the settled rows are now also refunded through
 * `try_refund_hour_session`, so a crashed or never-claimed turn does not keep a
 * charge for work that never happened.
 */
create or replace function public.settle_stalled_runs(p_owner uuid)
returns setof public.runs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_owner is null then
    return;
  end if;

  return query
  with settled as (
    update public.runs r
       set status = 'failed',
           stop_reason = 'error',
           error = case
             when r.status = 'queued'
               then 'No worker picked this run up. Start it again.'
             else 'The worker stopped reporting before this run finished. Start it again.'
           end,
           ended_at = now()
     where r.owner = p_owner
       and r.status in ('queued', 'running')
       and (
         (r.status = 'queued' and r.created_at < now() - interval '20 minutes')
         or (
           r.status = 'running'
           and coalesce(r.heartbeat_at, r.started_at, r.created_at)
             < now() - interval '5 minutes'
         )
       )
    returning r.*
  ),
  refunds as (
    select public.try_refund_hour_session(
             settled.owner,
             settled.credit_session_id::uuid,
             'the turn did not finish'
           ) as ok
      from settled
     where settled.credit_session_id is not null
  )
  select settled.*
    from settled
    cross join (select count(*) as n from refunds) as r;
end;
$$;

revoke all on function public.settle_stalled_runs(uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.settle_stalled_runs(uuid) to service_role;
  end if;
end
$$;
