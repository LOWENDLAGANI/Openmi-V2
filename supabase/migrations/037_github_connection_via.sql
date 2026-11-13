-- Which way the stored token arrived.
--
-- A pasted personal access token is the reader's own credential; a token issued
-- through the OAuth App is a grant this application can revoke. Disconnect needs
-- the difference, because only the second one should disappear from the reader's
-- authorized apps. Existing rows default to 'token': the OAuth flow stored
-- nothing else, and a sealed value cannot be inspected to guess.

alter table public.github_connections
  add column if not exists connected_via text not null default 'token';

comment on column public.github_connections.connected_via is
  'How the token arrived: a pasted personal access token, or an OAuth App grant. Disconnect revokes only the latter on GitHub.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'github_connections_connected_via_check'
      and conrelid = 'public.github_connections'::regclass
  ) then
    alter table public.github_connections
      add constraint github_connections_connected_via_check
      check (connected_via in ('token', 'oauth'));
  end if;
end
$$;
