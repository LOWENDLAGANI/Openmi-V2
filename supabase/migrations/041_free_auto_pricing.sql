-- Auto's hour is free, and DeepSeek Flash carries the catalogue price of 3 Dew.
--
-- The picker has always shown one price because the catalogue had one. It does
-- not: Auto routes to free upstreams, so an hour on it costs nothing. It still
-- opens an hour, because the session is what scopes a chat to a model — the
-- charge is a consequence of the session, not the reason for it. DeepSeek
-- Flash, the model a new chat opens on, costs the 3 Dew `DEW_PER_HOUR`
-- documents.
--
-- A price of zero is a real price, so the two functions that assumed a charge
-- always moves Dew learn about it here:
--   * `start_hour_session` skips `charge_dew_with_wallet` at a zero price (that
--     function refuses to move nothing, by design — it is the guard that stops
--     a bug from writing a zero-amount ledger row) and returns the untouched
--     balance, still with `started = true`.
--   * `refund_hour_session` marks a free hour refunded without writing a ledger
--     row, for the same reason: `dew_transactions.amount <> 0` would reject it.
--
-- The `else` stays at the catalogue default: a model this build has not been
-- taught must never become a free hour.

create or replace function public.model_hour_dew(p_model text)
returns numeric
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_model, '')))
    when 'auto' then 0::numeric
    when 'deepseek-flash' then 3::numeric
    -- A model this function has not been taught costs the catalogue default.
    else 3::numeric
  end;
$$;

revoke all on function public.model_hour_dew(text) from public, anon;
grant execute on function public.model_hour_dew(text) to authenticated;

/**
 * Starts an hour if there is not one running, at the price of the chosen model.
 *
 * An hour belongs to the chat that started it and to the model it was bought
 * for. A start for another chat, or for another model, is refused with what
 * holds it, which is what the composer turns into "continue there, or end it and
 * start here". Reusing the same chat's hour on the same model is free, so a
 * conversation inside its hour never pays twice. A model priced at nothing
 * opens its hour the same way: the row is written, nothing is charged.
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
  v_price numeric := public.model_hour_dew(p_model);
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

    -- The model is part of what was paid for, so switching mid-hour is an
    -- explicit act: end this hour, then start one on the other model.
    if v_session.model is distinct from p_model then
      raise exception 'dew: hour on model %',
        coalesce(v_session.model, 'another model')
        using errcode = 'P0001';
    end if;

    return query
      select v_session.session_id,
             false,
             v_session.expires_at,
             p.dew_balance,
             coalesce(v_session.price, v_price),
             p.wallet_dew,
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
      from public.charge_dew_with_wallet(
        v_uid, v_price, 'session', coalesce(p_model, 'session'),
        v_session.session_id, p_chat_id
      );
  else
    -- A free hour moves nothing, so there is nothing to charge and no ledger
    -- row to write: `dew_transactions.amount <> 0` is not a formality. The
    -- balances are read so the caller gets the same shape either way.
    select p.dew_balance as balance,
           p.wallet_dew as wallet,
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
$$;

revoke all on function public.start_hour_session(text, text, uuid)
  from public, anon;
grant execute on function public.start_hour_session(text, text, uuid)
  to authenticated;

/**
 * Refunds one session, once, at the price it was charged.
 *
 * The amount comes from the session row, not from a constant: an hour bought on
 * a 2 Dew model must not refund the flat 3 that a previous migration wrote, and
 * a balance that steps up by more than it stepped down is a ledger nobody can
 * reconcile. A free hour refunds nothing — it is marked refunded so the
 * once-only rule still holds, and no zero-amount row is attempted.
 *
 * Both signatures get the rule. The app refunds with the owner-taking one, so
 * fixing only the compatibility overload would leave a free hour failing the
 * `amount <> 0` check on the path that is actually used.
 */
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
  v_balance numeric;
begin
  if v_uid is null then
    raise exception 'dew: not signed in' using errcode = '28000';
  end if;

  select owner, started_at, coalesce(price, public.model_hour_dew(model))
    into v_owner, v_started, v_amount
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

  -- A free hour has nothing to give back; the mark above is its whole refund.
  if v_amount <= 0 then
    select p.dew_balance into v_balance
      from public.profiles p
     where p.id = v_uid;
    return v_balance;
  end if;

  update public.profiles
     set dew_balance = dew_balance + v_amount
   where id = v_uid
   returning dew_balance into v_balance;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, session_id, reference)
  values
    (v_uid, 'refund', v_amount, v_balance, p_session_id,
     left(coalesce(p_reason, 'refund'), 200));

  return v_balance;
end;
$$;

/**
 * The service-role refund: the app has the owner and the admin client.
 *
 * 029 moved refunds off the browser because a client-callable refund credits an
 * hour it can still use. This restates that: the compatibility signature stays
 * revoked from every client role, and only the service role may refund.
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

  -- A free hour has nothing to give back; the mark above is its whole refund.
  if v_amount <= 0 then
    select p.dew_balance into v_balance
      from public.profiles p
     where p.id = p_owner;
    return v_balance;
  end if;

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

revoke all on function public.refund_hour_session(uuid, text)
  from public, anon, authenticated;
revoke all on function public.refund_hour_session(uuid, uuid, text)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.refund_hour_session(uuid, uuid, text)
      to service_role;
  end if;
end
$$;
