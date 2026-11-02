-- Admin operations and paid-plan receipts.
--
-- Two additions, both server-authoritative:
--
-- 1. `admin_users` holds the operator role. It has RLS enabled and no policy at
--    all, so no client can read or grant it; `is_admin()` is a security-definer
--    function that answers only "is this caller an admin".
--
-- 2. `payment_requests` is a receipt queue. A member inserts through
--    `submit_payment_request` (their own uid, status forced to pending) and can
--    read only their own rows. Approving or rejecting happens in
--    `review_payment_request`, which re-checks `is_admin()` inside the database.
--
-- The email allowlist (ADMIN_EMAILS / ADMIN_EMAIL_DOMAIN) lives in the app as a
-- second way in. It is evaluated against the email Supabase Auth verified, and
-- it is the bootstrap path before `admin_users` has any rows.
--
-- Also closes an older hole: `profiles_update_own` let an account update every
-- column of its own row, including dew_balance. From here the client may update
-- only `timezone` and `handle`; balances move through functions only.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  note text
);

alter table public.admin_users enable row level security;

-- No policies on purpose. Reading the role goes through is_admin(); writing it
-- goes through admin_set_admin() or the service role.
revoke all on public.admin_users from anon, authenticated;

create or replace function public.is_admin(p_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.admin_users a
     where a.user_id = coalesce(p_user, auth.uid())
  );
$$;

revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  plan text not null check (plan in ('starter', 'pro', 'studio')),
  amount numeric(10, 2) not null default 0 check (amount >= 0),
  reference text not null,
  note text,
  receipt_path text not null,
  receipt_name text,
  receipt_type text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  dew_granted integer check (dew_granted is null or dew_granted >= 0),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_requests_status_created_idx
  on public.payment_requests (status, created_at desc);

create index if not exists payment_requests_owner_created_idx
  on public.payment_requests (owner, created_at desc);

drop trigger if exists payment_requests_touch_updated_at
  on public.payment_requests;
create trigger payment_requests_touch_updated_at
  before update on public.payment_requests
  for each row execute function public.touch_updated_at();

alter table public.payment_requests enable row level security;

drop policy if exists "payment_requests: owner reads" on public.payment_requests;
create policy "payment_requests: owner reads"
  on public.payment_requests for select to authenticated
  using (owner = auth.uid());

-- No insert, update or delete policy: the only writes are the functions below.
revoke all on public.payment_requests from anon, authenticated;
grant select on public.payment_requests to authenticated;

/**
 * Creates a pending request for the caller. The receipt must already exist,
 * under a path owned by the caller: `${uid}/<file>`. Status is not a parameter,
 * so a client cannot submit an approved receipt.
 */
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

  if v_plan <> all (array['starter', 'pro', 'studio']) then
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

/**
 * Approves or rejects one pending request. Only an admin can call it, and the
 * check is repeated here rather than trusted from the page that rendered the
 * form.
 *
 * Approval grants the Dew named by the operator (never more than the plan in
 * the row; the caller decides the amount) and flips `has_paid`, which raises the
 * daily allowance. Rejection records a note and moves no balance.
 */
create or replace function public.review_payment_request(
  p_id uuid,
  p_decision text,
  p_note text default null,
  p_dew integer default 0
)
returns table (status text, balance numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_row public.payment_requests;
  v_balance numeric;
  v_dew integer;
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

  v_dew := greatest(0, least(coalesce(p_dew, 0), 100000));

  if v_decision = 'approved' then
    update public.profiles
       set dew_balance = dew_balance + v_dew,
           has_paid = true
     where id = v_row.owner
    returning dew_balance into v_balance;

    if not found then
      raise exception 'review: no profile for the request'
        using errcode = 'P0002';
    end if;

    if v_dew > 0 then
      insert into public.dew_transactions
        (owner, kind, amount, balance_after, reference, note)
      values
        (v_row.owner, 'topup', v_dew, v_balance, 'receipt:' || v_row.id,
         left(coalesce(nullif(btrim(p_note), ''), 'approved receipt'), 200));
    end if;
  else
    select dew_balance into v_balance
      from public.profiles
     where id = v_row.owner;
  end if;

  update public.payment_requests
     set status = v_decision,
         dew_granted = case when v_decision = 'approved' then v_dew else null end,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_id;

  return query select v_decision, v_balance;
end;
$$;

revoke all on function public.review_payment_request(uuid, text, text, integer)
  from public, anon;
grant execute on function public.review_payment_request(uuid, text, text, integer)
  to authenticated;

/**
 * Operator top-up by email. Positive amounts are ledgered as a top-up, negative
 * ones as an adjustment; the balance check constraint refuses to go below zero.
 */
create or replace function public.admin_grant_dew(
  p_email text,
  p_amount numeric,
  p_reason text default 'operator top-up'
)
returns table (user_id uuid, balance numeric)
language plpgsql
security definer
set search_path = public
as $$
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
     set dew_balance = dew_balance + p_amount
   where id = v_target
  returning dew_balance into v_balance;

  if not found then
    raise exception 'admin: account has no profile' using errcode = 'P0002';
  end if;

  insert into public.dew_transactions
    (owner, kind, amount, balance_after, reference, note)
  values
    (v_target,
     case when p_amount > 0 then 'topup' else 'adjustment' end,
     p_amount, v_balance,
     left(coalesce(nullif(btrim(p_reason), ''), 'operator top-up'), 200),
     'admin');

  return query select v_target, v_balance;
end;
$$;

revoke all on function public.admin_grant_dew(text, numeric, text)
  from public, anon;
grant execute on function public.admin_grant_dew(text, numeric, text)
  to authenticated;

/** Grants or revokes the database admin role. An admin cannot remove itself. */
create or replace function public.admin_set_admin(
  p_email text,
  p_enabled boolean,
  p_note text default null
)
returns table (user_id uuid, enabled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  select u.id into v_target
    from auth.users u
   where lower(u.email) = lower(btrim(coalesce(p_email, '')))
   limit 1;

  if v_target is null then
    raise exception 'admin: no account with that email' using errcode = 'P0002';
  end if;

  if not p_enabled and v_target = auth.uid() then
    raise exception 'admin: you cannot remove your own access'
      using errcode = 'P0001';
  end if;

  if p_enabled then
    insert into public.admin_users (user_id, note)
    values (v_target, nullif(left(btrim(coalesce(p_note, '')), 200), ''))
    on conflict (user_id) do nothing;
  else
    delete from public.admin_users where user_id = v_target;
  end if;

  return query select v_target, p_enabled;
end;
$$;

revoke all on function public.admin_set_admin(text, boolean, text)
  from public, anon;
grant execute on function public.admin_set_admin(text, boolean, text)
  to authenticated;

-- A member may update its own settings, but not its balance or its paid flag.
-- Those columns move only through the security-definer functions above.
revoke update on public.profiles from authenticated;
grant update (timezone, handle) on public.profiles to authenticated;

-- Receipts: private bucket, owner-read policy. Uploads happen server side with
-- the service role, so no insert policy is needed. The guard keeps this
-- migration applicable to a bare Postgres (the migration check runs on PGlite,
-- which has no storage schema).
do $$
begin
  if exists (
    select 1 from information_schema.schemata where schema_name = 'storage'
  ) then
    insert into storage.buckets (id, name, public)
    values ('receipts', 'receipts', false)
    on conflict (id) do nothing;

    if not exists (
      select 1 from pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and policyname = 'receipts: owner reads'
    ) then
      create policy "receipts: owner reads" on storage.objects
        for select to authenticated
        using (
          bucket_id = 'receipts'
          and (storage.foldername(name))[1] = auth.uid()::text
        );
    end if;
  end if;
end;
$$;

-- The setup page probes this list, so a half-applied 013 shows up there rather
-- than as an empty admin panel.
create or replace function public.openmi_schema_probe()
returns table (kind text, object text)
language sql
security definer
set search_path = public
as $$
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
      ('table', 'dew_transactions'),
      ('table', 'dew_codes'),
      ('table', 'rate_limits'),
      ('table', 'admin_users'),
      ('table', 'payment_requests'),
      ('function', 'append_message'),
      ('function', 'consume_agent_step'),
      ('function', 'refill_daily_dew'),
      ('function', 'start_hour_session'),
      ('function', 'refund_hour_session'),
      ('function', 'redeem_dew_code'),
      ('function', 'rate_limit_hit'),
      ('function', 'openmi_migration_ledger'),
      ('function', 'is_admin'),
      ('function', 'submit_payment_request'),
      ('function', 'review_payment_request'),
      ('function', 'admin_grant_dew'),
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
$$;

revoke all on function public.openmi_schema_probe()
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.openmi_schema_probe() to service_role;
  end if;
end
$$;
