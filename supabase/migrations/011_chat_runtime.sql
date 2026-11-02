-- Phase 10: durable turns, usage recorded in one write, and a schema probe.
--
-- Three things are fixed here.
--
-- 1. `agent_turns` now carries a status, a cancel flag and the partial answer,
--    so a turn can outlive the HTTP request that started it. The chat route
--    writes the answer down whether or not the browser is still listening, and
--    the next page load can tell that a turn is still running instead of
--    showing a question with no answer.
--
-- 2. `append_message` records the token estimate in the same insert. The old
--    path appended a row, then updated `usage_tokens` separately — and
--    `messages` has select/insert/delete policies but no update policy, so that
--    update matched zero rows and failed silently. Every activity figure read 0
--    while the app looked healthy. Passing the value to the function that owns
--    the lock removes both the extra round trip and the silent no-op.
--
-- 3. `openmi_migration_ledger` reads the ledger's `statements` column through
--    `to_jsonb`, so a Supabase CLI version that does not have that column
--    reports "no checksum" instead of making the whole ledger unreadable. And
--    `openmi_schema_probe` reports objects the application calls but the
--    database does not have — the difference between "the migrations are
--    pending" and "chat is mysteriously broken".

alter table public.agent_turns
  add column if not exists status text not null default 'running'
    check (status in ('running', 'done', 'error', 'paused')),
  add column if not exists cancel_requested boolean not null default false,
  add column if not exists partial text,
  add column if not exists finished_at timestamptz;

create index if not exists agent_turns_chat_status_idx
  on public.agent_turns (chat_id, status, expires_at desc);

-- One replacement, not a change in place: a function's argument list is part of
-- its identity, so the four-argument version has to go before the five-argument
-- one can be granted cleanly.
drop function if exists public.append_message(uuid, text, text, text);

create or replace function public.append_message(
  p_chat_id uuid,
  p_role text,
  p_content text,
  p_model text default null,
  p_tokens integer default null
)
returns public.messages
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_next bigint;
  v_row public.messages;
  v_title text;
begin
  if v_owner is null then
    raise exception 'append_message needs a signed-in account'
      using errcode = '28000';
  end if;

  if p_role not in ('user', 'assistant', 'system') then
    raise exception 'unknown role: %', p_role using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(p_content, ''))) = 0 then
    raise exception 'a message cannot be empty' using errcode = '22023';
  end if;

  -- The chat row is the lock. One writer per chat, so the max(seq) below
  -- cannot be read by two transactions that then both insert n + 1.
  select left(btrim(c.title), 120) into v_title
    from public.chats c
   where c.id = p_chat_id
     and c.owner = v_owner
   for update;

  if not found then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  select coalesce(max(m.seq), 0) + 1 into v_next
    from public.messages m
   where m.chat_id = p_chat_id;

  insert into public.messages
    (chat_id, owner, role, content, model, seq, usage_tokens)
  values
    (p_chat_id, v_owner, p_role, btrim(p_content), p_model, v_next,
     case when p_tokens is null then null else greatest(p_tokens, 0) end)
  returning * into v_row;

  -- The first user message names the chat, once. Renaming later is a user act,
  -- so this only fires while the title is still the default.
  update public.chats
     set updated_at = now(),
         title = case
           when p_role = 'user' and v_title = 'New chat'
             then left(btrim(p_content), 80)
           else v_title
         end
   where id = p_chat_id;

  return v_row;
end;
$$;

revoke all on function public.append_message(uuid, text, text, text, integer)
  from public, anon;
grant execute on function public.append_message(uuid, text, text, text, integer)
  to authenticated;

-- Ledger reader, tolerant of a ledger table without a `statements` column.
create or replace function public.openmi_migration_ledger()
returns table (version text, name text, statements text[])
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select m.version,
           m.name,
           coalesce(
             (
               select array_agg(s.value)
                 from jsonb_array_elements_text(
                   to_jsonb(m) -> 'statements'
                 ) as s(value)
             ),
             '{}'::text[]
           )
      from supabase_migrations.schema_migrations m
     order by m.version;
exception
  when undefined_table or invalid_schema_name then
    -- A database without the Supabase CLI ledger is not an outage: the setup
    -- page reports an empty ledger rather than failing to render.
    return;
end;
$$;

revoke all on function public.openmi_migration_ledger()
  from public, anon, authenticated;

/**
 * Objects the application calls. A row here is a migration that did not run,
 * and the setup page says so by name instead of leaving chat to fail later.
 */
create or replace function public.openmi_schema_probe()
returns table (kind text, object text)
language sql
security definer
set search_path = public
as $$
  with required(kind, object) as (
    values
      ('table', 'folders'),
      ('table', 'chats'),
      ('table', 'messages'),
      ('table', 'github_connections'),
      ('table', 'agent_turns'),
      ('table', 'changesets'),
      ('table', 'changeset_files'),
      ('table', 'hour_sessions'),
      ('table', 'dew_transactions'),
      ('table', 'dew_codes'),
      ('table', 'rate_limits'),
      ('function', 'append_message'),
      ('function', 'consume_agent_step'),
      ('function', 'refill_daily_dew'),
      ('function', 'start_hour_session'),
      ('function', 'refund_hour_session'),
      ('function', 'redeem_dew_code'),
      ('function', 'rate_limit_hit'),
      ('function', 'openmi_migration_ledger')
  )
  select r.kind, r.object
    from required r
   where not exists (
           select 1
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where r.kind = 'table'
              and n.nspname = 'public'
              and c.relname = r.object
              and c.relkind in ('r', 'p')
         )
     and not exists (
           select 1
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where r.kind = 'function'
              and n.nspname = 'public'
              and p.proname = r.object
         )
   order by r.kind, r.object;
$$;

revoke all on function public.openmi_schema_probe()
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.openmi_migration_ledger() to service_role;
    grant execute on function public.openmi_schema_probe() to service_role;
  end if;
end
$$;
