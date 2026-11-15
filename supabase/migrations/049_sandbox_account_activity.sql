-- When each account was last tried, and when it last worked.
--
-- `sandbox_accounts` already records what went wrong (`last_failure`,
-- `last_failure_at`) and whether an account is set aside. The admin panel needs
-- one more thing to answer "which one is working right now": when a new sandbox
-- was last attempted on the account, and when one was last created on it
-- successfully. Without the second, an account with no live boxes looks the same
-- whether it is idle or broken.
--
-- Both are written by the creation path only — a chat attaching to a box it
-- already owns does not count as the account being tried, because the choice was
-- made when that box was created. Labels only: no key material was ever in this
-- table and none is added.

alter table public.sandbox_accounts
  add column if not exists last_tried_at timestamptz;

alter table public.sandbox_accounts
  add column if not exists last_ok_at timestamptz;

comment on column public.sandbox_accounts.last_tried_at is
  'When a new sandbox was last attempted on this account, whatever the outcome.';

comment on column public.sandbox_accounts.last_ok_at is
  'When this account last created a sandbox without being set aside.';

insert into public.openmi_meta (key, value)
values ('sandbox_account_activity', '1')
on conflict (key) do update set value = excluded.value;
