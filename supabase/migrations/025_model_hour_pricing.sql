-- Per-model hourly pricing, and an hour that belongs to one model.
--
-- Until now an hour was one flat price on every model. The picker lets a reader
-- choose a model, so the charge belongs to that model: `model_hour_dew` is the
-- only place an hour's price is decided, and `start_hour_session` charges it.
-- Both built-in models cost 2 Dew today, so the visible price is lower than the
-- flat 3 it replaces; a model priced differently changes this function and
-- `lib/models.ts` together, and tests/dew.test.ts reads both.
--
-- The hour is also locked to its model the way migration 019 locked it to a
-- chat. Asking for a different model while an hour runs is refused, instead of
-- quietly settling an hour paid on one model against a turn for another.
--
-- `hour_sessions.price` records what was actually charged, so a refund returns
-- that hour's price rather than a number from the current catalogue.

alter table public.hour_sessions
  add column if not exists price numeric(12, 3);

-- An hour that predates this column was charged the flat 3 Dew.
update public.hour_sessions set price = 3 where price is null;

/**
 * An hour on one model, in Dew. A function rather than a browser value: a client
 * that sends `price: 0` is ignored because the price is never an argument.
 */
create or replace function public.model_hour_dew(p_model text)
returns numeric
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_model, '')))
    when 'gpt-oss-120b' then 2::numeric
    when 'deepseek-flash' then 2::numeric
    -- A model this function has not been taught costs the catalogue default, so
    -- an unlisted CUSTOM_MODELS entry can never become a free hour.
    else 2::numeric
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
 * conversation inside its hour never pays twice.
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

  -- Raises before committing anything if the balance and wallet cannot cover
  -- the hour; the insert above is rolled back with the exception.
  select * into v_charged
    from public.charge_dew_with_wallet(
      v_uid, v_price, 'session', coalesce(p_model, 'session'),
      v_session.session_id, p_chat_id
    );

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
 * reconcile.
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

revoke all on function public.refund_hour_session(uuid, text) from public, anon;
grant execute on function public.refund_hour_session(uuid, text) to authenticated;
