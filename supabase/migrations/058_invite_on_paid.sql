-- Invite rewards pay out once, when the invited account activates its first
-- paid pass — never on raw sign-up.
--
-- Recording `invited_by` at sign-up keeps the attribution intact while closing
-- self-farming through throwaway or unconfirmed accounts.

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_inviter uuid;
  v_code text;
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
      update public.profiles
         set invited_by = v_inviter
       where id = new.id
         and invited_by is null;
    end if;
  end if;

  return new;
end;
$function$;

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
  v_inviter uuid;
  v_invite_rewarded boolean;
  v_inviter_wallet numeric;
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
    returning wallet_credit, credit_balance, invited_by, invite_rewarded
         into v_wallet, v_balance, v_inviter, v_invite_rewarded;

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

      -- Grant the one-time invite reward once the invited account activates its
      -- first paid pass, subject to the 10-rewarded-accounts cap per inviter.
      if v_inviter is not null
         and v_inviter <> v_row.owner
         and not coalesce(v_invite_rewarded, false) then
        perform pg_advisory_xact_lock(hashtextextended(v_inviter::text, 0));

        if (
          select count(*)
            from public.profiles p
           where p.invited_by = v_inviter
             and p.invite_rewarded
        ) < 10 then
          update public.profiles
             set invite_rewarded = true,
                 wallet_credit = wallet_credit + 5
           where id = v_row.owner
             and not invite_rewarded
          returning wallet_credit into v_wallet;

          if found then
            insert into public.credit_transactions
              (owner, kind, amount, balance_after, reference, note)
            values
              (v_row.owner, 'invite', 5, v_wallet, v_inviter::text,
               'invite bonus on first paid pass');

            update public.profiles
               set wallet_credit = wallet_credit + 5
             where id = v_inviter
            returning wallet_credit into v_inviter_wallet;

            if found then
              insert into public.credit_transactions
                (owner, kind, amount, balance_after, reference, note)
              values
                (v_inviter, 'invite', 5, v_inviter_wallet, v_row.owner::text,
                 'invited account activated a paid pass');
            end if;
          end if;
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

-- Attach an invite code after OAuth sign-up (e.g. Google), where raw_user_meta_data
-- does not carry the form field. Only attaches attribution on accounts that have
-- not yet been attributed, rewarded, or paid — never grants Credit directly.
create or replace function public.claim_invite_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_inviter uuid;
begin
  if v_uid is null or v_code = '' then
    return false;
  end if;

  select id into v_inviter
    from public.profiles
   where upper(invite_code) = v_code;

  if v_inviter is null or v_inviter = v_uid then
    return false;
  end if;

  update public.profiles
     set invited_by = v_inviter
   where id = v_uid
     and invited_by is null
     and not coalesce(invite_rewarded, false)
     and not coalesce(has_paid, false);

  return found;
end;
$$;

revoke all on function public.claim_invite_code(text) from public, anon;
grant execute on function public.claim_invite_code(text) to authenticated;
