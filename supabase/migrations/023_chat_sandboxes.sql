-- Phase 12: one live Linux workspace per chat.
--
-- A chat is not a run. A run observes one changeset and is thrown away; a chat
-- is a conversation, and making the user pay to reseed the same tree on every
-- message is the waste this table exists to stop. The environment is a
-- non-ephemeral container: it is stopped when the chat goes idle (compute
-- released, filesystem kept) and destroyed after `CHAT_SANDBOX_TTL_HOURS` of
-- inactivity.
--
-- `id` is the primary key rather than `chat_id` because a wipe can outlive its
-- chat: purge deletes the chat row, and `on delete set null` leaves this row
-- behind with the sandbox id the sweep still needs. Cascading here would delete
-- the only record of a container that is still billing.
--
-- Service role only. The browser has no sandbox control surface, so there are
-- no policies and no grants; `tests/rls-audit.test.ts` checks both.

create table if not exists public.chat_sandboxes (
  id                  uuid primary key default gen_random_uuid(),
  -- One environment per chat. Nullable after a purge, while the wipe finishes.
  chat_id             uuid unique references public.chats(id) on delete set null,
  owner               uuid not null references auth.users(id) on delete cascade,
  provider            text not null default 'daytona'
                        check (provider in ('daytona')),
  sandbox_id          text not null unique,
  state               text not null default 'provisioning'
                        check (state in ('provisioning','running','stopped',
                                         'archived','wiping','failed')),
  -- What this disk was seeded from. A pin change is a reseed, not a reuse:
  -- keeping a tree from another commit is how a model reasons about code that
  -- is not there.
  repo_full_name      text not null,
  base_sha            text not null,
  workspace_seeded_at timestamptz,
  last_active_at      timestamptz not null default now(),
  -- A live turn holds the box. The sweep must not stop or wipe a leased row,
  -- so a wipe cannot land on a turn that started one second before the deadline.
  lease_until         timestamptz,
  stopped_at          timestamptz,
  archived_at         timestamptz,
  -- last_active_at + CHAT_SANDBOX_TTL_HOURS. Stored, not computed, so the
  -- sweep is an index scan and the card and the sweep cannot disagree.
  delete_after        timestamptz not null,
  wipe_attempts       integer not null default 0,
  failure_code        text,
  failure_detail      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists chat_sandboxes_owner_active_idx
  on public.chat_sandboxes (owner, last_active_at desc);

-- The idle pass. Partial on purpose: a stopped or failed row is not a stop
-- candidate, and this index stays small as rows are wiped.
create index if not exists chat_sandboxes_idle_idx
  on public.chat_sandboxes (last_active_at)
  where state = 'running';

-- The due pass, including rows already in `wiping`: a failed provider delete is
-- retried by the same query on the next sweep.
create index if not exists chat_sandboxes_due_idx
  on public.chat_sandboxes (delete_after);

drop trigger if exists chat_sandboxes_touch_updated_at on public.chat_sandboxes;
create trigger chat_sandboxes_touch_updated_at
  before update on public.chat_sandboxes
  for each row execute function public.touch_updated_at();

alter table public.chat_sandboxes enable row level security;

revoke all on public.chat_sandboxes from anon, authenticated;

comment on table public.chat_sandboxes is
  'One chat-scoped sandbox: stopped after idle, wiped after CHAT_SANDBOX_TTL_HOURS.';
