-- Phase 5: proposed edits, reviewed in the app.
--
-- A changeset is a row per turn that proposed files. Its files hold the whole
-- proposed text and the diff that was rendered from it, so a review card can be
-- rebuilt without asking GitHub again — the base commit may have moved on, and
-- a review must show what was actually proposed.
--
-- Nothing here writes to GitHub. There is no branch, commit or PR column yet:
-- those arrive in phase 6, after a signature has been checked. `status` still
-- names them so the phase-6 transition does not need a migration.
--
-- The signature is checked in the application, not in SQL. What the database
-- enforces is that a changeset cannot be marked ready or approved without one,
-- so an unsigned draft cannot be mistaken for a reviewable proposal.

create table if not exists public.changesets (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  turn_id uuid,
  repo_full_name text not null,
  base_sha text not null,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'approved', 'committed', 'failed', 'expired')),
  content_hash text,
  signature text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint changesets_signed_when_reviewable
    check (
      status not in ('ready', 'approved', 'committed')
      or (signature is not null and content_hash is not null)
    )
);

create index if not exists changesets_chat_created_idx
  on public.changesets (chat_id, created_at desc);

create index if not exists changesets_owner_created_idx
  on public.changesets (owner, created_at desc);

create index if not exists changesets_turn_idx
  on public.changesets (turn_id);

alter table public.changesets enable row level security;

drop policy if exists "changesets: owner reads" on public.changesets;
create policy "changesets: owner reads"
  on public.changesets for select to authenticated
  using (owner = auth.uid());

drop policy if exists "changesets: owner inserts" on public.changesets;
create policy "changesets: owner inserts"
  on public.changesets for insert to authenticated
  with check (
    owner = auth.uid()
    and exists (
      select 1 from public.chats c
      where c.id = chat_id and c.owner = auth.uid()
    )
  );

drop policy if exists "changesets: owner updates" on public.changesets;
create policy "changesets: owner updates"
  on public.changesets for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

drop policy if exists "changesets: owner deletes" on public.changesets;
create policy "changesets: owner deletes"
  on public.changesets for delete to authenticated
  using (owner = auth.uid());

drop trigger if exists changesets_touch on public.changesets;
create trigger changesets_touch
  before update on public.changesets
  for each row execute function public.touch_updated_at();

create table if not exists public.changeset_files (
  id uuid primary key default gen_random_uuid(),
  changeset_id uuid not null references public.changesets(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  path text not null check (char_length(path) between 1 and 400),
  mode text not null check (mode in ('write', 'replace')),
  original_content text,
  proposed_content text not null,
  diff text not null,
  additions integer not null default 0 check (additions >= 0),
  deletions integer not null default 0 check (deletions >= 0),
  diff_truncated boolean not null default false,
  accepted boolean not null default true,
  error text,
  created_at timestamptz not null default now(),
  unique (changeset_id, path)
);

create index if not exists changeset_files_changeset_idx
  on public.changeset_files (changeset_id, path);

alter table public.changeset_files enable row level security;

drop policy if exists "changeset_files: owner reads" on public.changeset_files;
create policy "changeset_files: owner reads"
  on public.changeset_files for select to authenticated
  using (owner = auth.uid());

drop policy if exists "changeset_files: owner inserts" on public.changeset_files;
create policy "changeset_files: owner inserts"
  on public.changeset_files for insert to authenticated
  with check (
    owner = auth.uid()
    and exists (
      select 1 from public.changesets s
      where s.id = changeset_id and s.owner = auth.uid()
    )
  );

drop policy if exists "changeset_files: owner updates" on public.changeset_files;
create policy "changeset_files: owner updates"
  on public.changeset_files for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

drop policy if exists "changeset_files: owner deletes" on public.changeset_files;
create policy "changeset_files: owner deletes"
  on public.changeset_files for delete to authenticated
  using (owner = auth.uid());
