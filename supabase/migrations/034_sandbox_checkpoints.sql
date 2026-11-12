-- P14: a chat's workspace keeps versions.
--
-- Every turn that changes a file leaves a commit inside the chat's own clone,
-- and this table is the index the transcript reads. Nothing here is pushed: the
-- commit lives on the sandbox's `openmi/work/<chat>` branch and dies with the
-- box, which is why the row is a pointer and not a backup. GitHub remains the
-- only place a change survives, through the changeset path.
--
-- One row per commit: the unique pair makes a turn that ends twice (a retry, a
-- paused continuation) record the same version once instead of twice.
--
-- Service role only, like the sandbox it belongs to. Restoring is a server
-- action that first proves the chat belongs to the caller.

create table if not exists public.sandbox_checkpoints (
  id            uuid primary key default gen_random_uuid(),
  chat_id       uuid not null references public.chats(id) on delete cascade,
  owner         uuid not null references auth.users(id) on delete cascade,
  sandbox_id    text not null,
  -- The commit inside the chat's clone, never a GitHub sha the product claims
  -- to have written.
  commit_sha    text not null check (commit_sha ~ '^[0-9a-f]{7,40}$'),
  label         text not null check (char_length(label) between 1 and 80),
  -- The turn that produced it, when one did. A manual save has none.
  turn_id       text,
  files_changed integer not null default 0 check (files_changed >= 0),
  source        text not null default 'turn'
                  check (source in ('turn','manual')),
  created_at    timestamptz not null default now(),
  unique (chat_id, commit_sha)
);

create index if not exists sandbox_checkpoints_chat_idx
  on public.sandbox_checkpoints (chat_id, created_at desc);

alter table public.sandbox_checkpoints enable row level security;

revoke all on public.sandbox_checkpoints from anon, authenticated;

comment on table public.sandbox_checkpoints is
  'Versions of a chat workspace: commits in the sandbox clone, restorable while the box lives.';
