-- P13: a chat can show the app it is building.
--
-- A preview is a row, not a flag. The panel has to survive a reload, say which
-- port the dev server is on, and still be able to name what failed after the
-- request that started it is gone. One row per chat, because a chat owns one
-- workspace and therefore one dev server inside it.
--
-- The port and the process id are recorded rather than rediscovered: a
-- framework can fall back to another port, and stopping a preview has to kill
-- the process it started rather than a name it matched. The process id is only
-- ever produced by `previewProcessId()` and read back from this table.
--
-- Service role only, like the sandbox row it belongs to. The browser names a
-- chat and never a container; the route derives this row after the session has
-- proved the chat is the caller's.

create table if not exists public.chat_previews (
  id             uuid primary key default gen_random_uuid(),
  -- One dev server per chat. A purged chat takes its preview row with it: the
  -- row names no provider container, so nothing is left billing.
  chat_id        uuid not null unique references public.chats(id) on delete cascade,
  owner          uuid not null references auth.users(id) on delete cascade,
  sandbox_id     text not null,
  process_id     text,
  port           integer check (port is null or (port between 1 and 65535)),
  command        text,
  url            text,
  state          text not null default 'stopped'
                   check (state in ('starting','ready','stopped','failed')),
  failure_detail text,
  started_at     timestamptz,
  stopped_at     timestamptz,
  last_hit_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists chat_previews_owner_idx
  on public.chat_previews (owner);

-- Only a ready preview is ever swept or listed by state; a failed or stopped
-- row is not a candidate, so the partial index stays small.
create index if not exists chat_previews_ready_idx
  on public.chat_previews (state)
  where state = 'ready';

drop trigger if exists chat_previews_touch_updated_at on public.chat_previews;
create trigger chat_previews_touch_updated_at
  before update on public.chat_previews
  for each row execute function public.touch_updated_at();

alter table public.chat_previews enable row level security;

revoke all on public.chat_previews from anon, authenticated;

comment on table public.chat_previews is
  'The dev server one chat is previewing: port, process, url and why a start failed.';
