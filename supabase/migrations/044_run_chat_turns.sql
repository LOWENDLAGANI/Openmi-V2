-- A run is a chat turn.
--
-- Execution of a chat message moved to the worker, which owns the sandbox and
-- outlives the request. The one write it owes the chat is the answer itself.
-- `append_message` cannot do it: it derives the owner from `auth.uid()`, and
-- the service role has no JWT. This is its counterpart — same lock on the chat
-- row, same sequence rule, same caps — but the owner is a parameter, so it is
-- granted to `service_role` alone.

-- The chat page asks "is a run still live for this chat?" on every load.
create index if not exists runs_chat_created_idx
  on public.runs (chat_id, created_at desc);

-- The hour a chat turn was charged is refunded when the run fails with nothing
-- to show. The worker settles out of band, so it needs the session id on the
-- run rather than in a request that may already be gone.
alter table public.runs
  add column if not exists dew_session_id text;

create or replace function public.append_worker_message(
  p_owner uuid,
  p_chat_id uuid,
  p_role text,
  p_content text,
  p_model text default null,
  p_tokens integer default null,
  p_thinking text default null,
  p_steps jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
  v_row public.messages;
begin
  if p_role not in ('user', 'assistant', 'system') then
    raise exception 'unknown role: %', p_role using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(p_content, ''))) = 0 then
    raise exception 'a message cannot be empty' using errcode = '22023';
  end if;

  if p_steps is not null and jsonb_typeof(p_steps) <> 'array' then
    raise exception 'steps must be a JSON array' using errcode = '22023';
  end if;

  if p_steps is not null and jsonb_array_length(p_steps) > 60 then
    raise exception 'a message keeps at most 60 steps' using errcode = '22023';
  end if;

  -- The chat row is the lock, exactly as in append_message: two writers cannot
  -- both read n and insert n + 1.
  perform 1
     from public.chats c
    where c.id = p_chat_id
      and c.owner = p_owner
    for update;

  if not found then
    raise exception 'chat not found' using errcode = 'P0002';
  end if;

  select coalesce(max(m.seq), 0) + 1 into v_next
    from public.messages m
   where m.chat_id = p_chat_id;

  insert into public.messages
    (chat_id, owner, role, content, model, seq, usage_tokens, thinking, steps)
  values
    (p_chat_id, p_owner, p_role, btrim(p_content), p_model, v_next,
     case when p_tokens is null then null else greatest(p_tokens, 0) end,
     nullif(btrim(coalesce(p_thinking, '')), ''),
     coalesce(p_steps, '[]'::jsonb))
  returning * into v_row;

  update public.chats
     set updated_at = now()
   where id = p_chat_id;

  return jsonb_build_object('id', v_row.id, 'seq', v_row.seq);
end;
$$;

-- Supabase always has these roles; a bare Postgres (CI, PGlite) does not, so
-- both statements are guarded the same way 043 guards its grants.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.append_worker_message(
      uuid, uuid, text, text, text, integer, text, jsonb
    ) to service_role;
  end if;
end $$;

revoke all on function public.append_worker_message(
  uuid, uuid, text, text, text, integer, text, jsonb
) from public;
