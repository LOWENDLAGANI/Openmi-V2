-- A profile row per account, created by the database rather than the client.
-- A signup that succeeds must never leave an account without a profile, and a
-- client that forgets to insert one must not be able to produce that state.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  handle text,
  timezone text not null default 'Asia/Kuala_Lumpur',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Deliberately no insert or delete policy. Rows are created by the trigger
-- below and removed by the cascade when the account goes. A client that could
-- insert here could create a profile for somebody else's id.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, handle)
  values (
    new.id,
    new.email,
    nullif(split_part(coalesce(new.email, ''), '@', 1), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
