-- An operator can put a paid pass on an account, or take it off, by hand.
--
-- Until now a pass only began when `review_payment_request` approved a receipt.
-- Support needs the same power directly: a comped month, a refunded charge, a
-- test account. `p_days` is the whole instruction:
--   * above zero extends from the later of now and the current end — the same
--     arithmetic approval uses, so granting to a running pass adds to it and
--     never shortens it;
--   * zero revokes: the window ends now. `has_paid` stays true because it is
--     history ("a pass was ever bought"), and the next daily refill falls back
--     to the free allowance on its own, since entitlement is `paid_until`.
--
-- No Dew moves here, so there is no ledger row: `dew_transactions.amount <> 0`
-- would refuse one, and the entitlement lives on `profiles.paid_until`. The
-- function re-checks `is_admin()` even though the panel already did, so a future
-- caller that forgets cannot mint a pass.

create or replace function public.admin_set_pass(
  p_email text,
  p_days integer
)
returns table (user_id uuid, paid_until timestamptz, has_paid boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_days integer := coalesce(p_days, 0);
  v_target uuid;
  v_until timestamptz;
  v_paid boolean;
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  if v_email = '' then
    raise exception 'pass: an email is required' using errcode = '22023';
  end if;

  -- Ten years is a ceiling, not a policy: it keeps a typo from minting a
  -- lifetime pass nobody can explain.
  if v_days < 0 or v_days > 3660 then
    raise exception 'pass: days must be between 0 and 3660'
      using errcode = '22023';
  end if;

  select u.id into v_target
    from auth.users u
   where lower(u.email) = v_email
   limit 1;

  if v_target is null then
    raise exception 'pass: no account with that email' using errcode = 'P0002';
  end if;

  update public.profiles p
     set has_paid = p.has_paid or v_days > 0,
         paid_until = case
           when v_days > 0 then
             greatest(coalesce(p.paid_until, now()), now())
               + make_interval(days => v_days)
           else now()
         end
   where p.id = v_target
  returning p.id, p.paid_until, p.has_paid
       into v_target, v_until, v_paid;

  if not found then
    raise exception 'pass: account has no profile' using errcode = 'P0002';
  end if;

  return query select v_target, v_until, v_paid;
end;
$$;

revoke all on function public.admin_set_pass(text, integer) from public, anon;
grant execute on function public.admin_set_pass(text, integer) to authenticated;
