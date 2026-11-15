-- Which E2B account owns a sandbox.
--
-- A sandbox id is scoped to the team that created it: connecting with another
-- account's key answers 404. So an id on its own is not enough to find a box —
-- one deployment key worked only because there was exactly one team. These
-- columns are the missing half of every stored id: the account that created it.
--
-- `default` is the legacy single key (`E2B_API_KEY`), which is why the chat
-- column can be `not null` without rewriting existing rows. A deployment that
-- has moved to `E2B_ACCOUNTS` keeps the legacy key for one TTL window, so every
-- row that says `default` is still reachable until its box is wiped.
--
-- `sandbox_accounts` is the fleet's memory of which accounts are usable: a
-- sandbox limit reached on one account must be visible to every server process,
-- not just the one that saw it. It holds labels only — no key material.
--
-- Service role only, like `chat_sandboxes`: the browser never names an account.

alter table public.chat_sandboxes
  add column if not exists sandbox_account text not null default 'default';

alter table public.runs
  add column if not exists sandbox_account text;

-- Verification runs and missions are the same table, split by `kind`.
alter table public.execution_runs
  add column if not exists sandbox_account text;

-- Account selection and the per-account count the admin panel shows.
create index if not exists chat_sandboxes_account_idx
  on public.chat_sandboxes (sandbox_account, state);

create index if not exists runs_account_idx
  on public.runs (sandbox_account)
  where sandbox_id is not null;

create index if not exists execution_runs_account_idx
  on public.execution_runs (sandbox_account)
  where sandbox_id is not null;

create table if not exists public.sandbox_accounts (
  id               text primary key,
  state            text not null default 'active'
                     check (state in ('active','cooling','disabled')),
  set_aside_until  timestamptz,
  last_failure     text,
  last_failure_at  timestamptz,
  failures         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.sandbox_accounts enable row level security;

revoke all on public.sandbox_accounts from anon, authenticated;

drop trigger if exists sandbox_accounts_touch_updated_at on public.sandbox_accounts;
create trigger sandbox_accounts_touch_updated_at
  before update on public.sandbox_accounts
  for each row execute function public.touch_updated_at();

comment on column public.chat_sandboxes.sandbox_account is
  'The E2B account label that created sandbox_id; the key to open it with.';

comment on table public.sandbox_accounts is
  'Fleet-wide state of each E2B account label: active, cooling or disabled.';

insert into public.openmi_meta (key, value)
values ('sandbox_accounts', '1')
on conflict (key) do update set value = excluded.value;
