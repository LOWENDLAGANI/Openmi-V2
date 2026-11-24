-- Real-time website presence for the operations panel (/admin).
--
-- Security model:
--   1. `user_presence` has RLS enabled with no client policies and no grants
--      to `anon` or `authenticated`. It is service-role only, just like
--      `rate_limits` and `chat_sandboxes`.
--   2. Browser tabs send a lightweight same-origin heartbeat to POST /api/presence;
--      the server resolves the signed-in session (or validates an anonymous tab
--      visitor id) and upserts the row using the service role.
--   3. Only verified operators (/admin and GET /api/admin/presence) read it.

create table if not exists public.user_presence (
  session_key   text primary key,
  user_id       uuid references auth.users(id) on delete cascade,
  email         text,
  handle        text,
  last_path     text not null default '/',
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists user_presence_last_seen_idx
  on public.user_presence (last_seen_at desc);

create index if not exists user_presence_user_last_seen_idx
  on public.user_presence (user_id, last_seen_at desc)
  where user_id is not null;

alter table public.user_presence enable row level security;

revoke all on public.user_presence from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.user_presence to service_role;
  end if;
end $$;
