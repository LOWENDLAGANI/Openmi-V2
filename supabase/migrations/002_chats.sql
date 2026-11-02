-- Folders, chats and messages.
--
-- Two decisions worth keeping:
--
-- 1. Trash is a timestamp, not a table. `deleted_at` keeps the diff small and
--    makes "restore" a single update. Purging is the only destructive path.
-- 2. A chat may only point at a folder its owner owns. RLS enforces that on
--    write, not the client, because a folder id is just a uuid and the client
--    is the one guessing it.

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists folders_owner_idx
  on public.folders (owner, created_at);

alter table public.folders enable row level security;

create policy folders_select_own on public.folders
  for select to authenticated using (owner = auth.uid());

create policy folders_insert_own on public.folders
  for insert to authenticated with check (owner = auth.uid());

create policy folders_update_own on public.folders
  for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

create policy folders_delete_own on public.folders
  for delete to authenticated using (owner = auth.uid());

create trigger folders_touch_updated_at
  before update on public.folders
  for each row execute function public.touch_updated_at();

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  title text not null default 'New chat'
    check (char_length(btrim(title)) between 1 and 120),
  repo_full_name text,
  base_branch text,
  model text not null default 'auto'
    check (model in ('auto', 'code', 'flash')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists chats_owner_updated_idx
  on public.chats (owner, updated_at desc);

create index if not exists chats_owner_folder_idx
  on public.chats (owner, folder_id);

alter table public.chats enable row level security;

create policy chats_select_own on public.chats
  for select to authenticated using (owner = auth.uid());

create policy chats_insert_own on public.chats
  for insert to authenticated
  with check (
    owner = auth.uid()
    and (
      folder_id is null
      or exists (
        select 1 from public.folders f
        where f.id = folder_id and f.owner = auth.uid()
      )
    )
  );

create policy chats_update_own on public.chats
  for update to authenticated
  using (owner = auth.uid())
  with check (
    owner = auth.uid()
    and (
      folder_id is null
      or exists (
        select 1 from public.folders f
        where f.id = folder_id and f.owner = auth.uid()
      )
    )
  );

create policy chats_delete_own on public.chats
  for delete to authenticated using (owner = auth.uid());

create trigger chats_touch_updated_at
  before update on public.chats
  for each row execute function public.touch_updated_at();

-- Messages exist from phase 1 so the schema never needs a rewrite when chat
-- lands in phase 3. Nothing writes to them yet.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  model text,
  seq bigint not null default 0,
  usage_tokens integer,
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_order_idx
  on public.messages (chat_id, seq, created_at);

alter table public.messages enable row level security;

create policy messages_select_own on public.messages
  for select to authenticated
  using (
    owner = auth.uid()
    and exists (
      select 1 from public.chats c
      where c.id = chat_id and c.owner = auth.uid()
    )
  );

create policy messages_insert_own on public.messages
  for insert to authenticated
  with check (
    owner = auth.uid()
    and exists (
      select 1 from public.chats c
      where c.id = chat_id and c.owner = auth.uid()
    )
  );

create policy messages_delete_own on public.messages
  for delete to authenticated
  using (
    owner = auth.uid()
    and exists (
      select 1 from public.chats c
      where c.id = chat_id and c.owner = auth.uid()
    )
  );
