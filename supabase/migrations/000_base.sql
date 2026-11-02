-- The first table exists so the migration pipeline has something real to apply
-- twice before any product table depends on it. It stores schema markers the
-- setup page reads; it is not a user-facing surface.
--
-- RLS is enabled in the migration that creates the table, not later: a table
-- without RLS is readable by the anon key the moment it exists.

create table if not exists public.openmi_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.openmi_meta enable row level security;

-- Nothing on the client needs this table. Only the service role reads it, and
-- the service role bypasses RLS by design.
revoke all on public.openmi_meta from anon, authenticated;

insert into public.openmi_meta (key, value)
values ('schema_version', '0')
on conflict (key) do nothing;
