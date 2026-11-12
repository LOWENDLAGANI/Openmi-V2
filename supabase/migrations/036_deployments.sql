-- P16: publishing a chat's app.
--
-- A deployment row is a report of what the provider said, not an intention. The
-- URL is stored because the provider returned it, the state is stored because
-- the provider reported it, and the panel renders only what is here. A failed
-- build keeps its message and no URL, which is the difference between "publish
-- failed" and a link that goes nowhere.
--
-- One row per provider deployment, unique on the provider's id: polling the same
-- deployment updates a row instead of adding a second one.
--
-- Service role only. Publishing is a server action with the caller's session and
-- the operator's provider token; the browser never names a deployment.

create table if not exists public.deployments (
  id            uuid primary key default gen_random_uuid(),
  chat_id       uuid not null references public.chats(id) on delete cascade,
  owner         uuid not null references auth.users(id) on delete cascade,
  provider      text not null default 'vercel' check (provider in ('vercel')),
  deployment_id text not null unique,
  repo_full_name text not null,
  branch        text not null,
  commit_sha    text not null check (commit_sha ~ '^[0-9a-f]{7,40}$'),
  state         text not null default 'queued'
                  check (state in ('queued','building','ready','error','cancelled','unknown')),
  -- The provider's hostname, not a URL this app built. Null until ready.
  url           text,
  error_message text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists deployments_chat_idx
  on public.deployments (chat_id, created_at desc);

drop trigger if exists deployments_touch_updated_at on public.deployments;
create trigger deployments_touch_updated_at
  before update on public.deployments
  for each row execute function public.touch_updated_at();

alter table public.deployments enable row level security;

revoke all on public.deployments from anon, authenticated;

comment on table public.deployments is
  'What the hosting provider reported for a published chat app: state, url, error.';
