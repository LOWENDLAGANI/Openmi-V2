-- Phase 2: the GitHub connection and the commit pin.
--
-- A token is a credential, so it never leaves the server. It is sealed with
-- AES-256-GCM (see lib/crypto.ts) before insert, and only the last four
-- characters are stored in the clear so the status endpoint can say "connected
-- as octocat" without decrypting anything.
--
-- RLS keeps the row owner-scoped like every other table. The policy grants the
-- owner their own sealed row; it does not make the token readable, because the
-- ciphertext is useless without GITHUB_TOKEN_KEY, which lives only in the
-- server environment.

create table if not exists public.github_connections (
  owner uuid primary key references auth.users (id) on delete cascade,
  login text not null check (char_length(login) between 1 and 100),
  scopes text[] not null default '{}',
  token_sealed text not null check (token_sealed like 'v1.%'),
  token_last_four text not null check (char_length(token_last_four) between 0 and 4),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.github_connections.token_sealed is
  'AES-256-GCM under GITHUB_TOKEN_KEY, format v1.<iv>.<tag>.<ciphertext>. Never selected into a page payload.';

comment on column public.github_connections.token_last_four is
  'The only part of the token that may be shown to the browser.';

alter table public.github_connections enable row level security;

drop policy if exists "github_connections: owner reads" on public.github_connections;
create policy "github_connections: owner reads"
  on public.github_connections for select to authenticated
  using (owner = auth.uid());

drop policy if exists "github_connections: owner inserts" on public.github_connections;
create policy "github_connections: owner inserts"
  on public.github_connections for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists "github_connections: owner updates" on public.github_connections;
create policy "github_connections: owner updates"
  on public.github_connections for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

drop policy if exists "github_connections: owner deletes" on public.github_connections;
create policy "github_connections: owner deletes"
  on public.github_connections for delete to authenticated
  using (owner = auth.uid());

drop trigger if exists github_connections_touch on public.github_connections;
create trigger github_connections_touch
  before update on public.github_connections
  for each row execute function public.touch_updated_at();

-- The commit pin. A chat is anchored to one repository at one commit, so a
-- proposed diff always has exactly one base to compare against.
alter table public.chats
  add column if not exists repo_branch text,
  add column if not exists repo_base_sha text;

comment on column public.chats.repo_base_sha is
  'The commit every read, and later every diff, is pinned to. Null until a repository is attached.';
