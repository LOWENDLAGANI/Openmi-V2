-- Keep the work with the answer it produced.
--
-- A step and a chain of thought used to live only in the browser tab: the row
-- stored `content` and nothing else, so a reload rebuilt the transcript from
-- text and the console vanished exactly when the work mattered. These two
-- columns are the record the transcript needs to survive a reload, on every
-- device, without inventing a second table for what is one answer's homework.

alter table public.messages
  add column if not exists thinking text,
  add column if not exists steps jsonb not null default '[]'::jsonb;

-- Applied twice cleanly: a constraint is dropped before it is added, so the
-- second pass is a no-op rather than a duplicate-object error.
alter table public.messages drop constraint if exists messages_steps_is_array;
alter table public.messages
  add constraint messages_steps_is_array check (jsonb_typeof(steps) = 'array');

alter table public.messages drop constraint if exists messages_steps_cap;
alter table public.messages
  add constraint messages_steps_cap check (jsonb_array_length(steps) <= 60);

-- One replacement, not an overload. A function's argument list is its
-- identity: a five-argument version left behind would make the three-argument
-- call the tests use ambiguous.
drop function if exists public.append_message(uuid, text, text, text);
drop function if exists public.append_message(uuid, text, text, text, integer);
drop function if exists public.append_message(uuid, text, text, text, integer, text, jsonb);

create or replace function public.append_message(
  p_chat_id uuid,
  p_role text,
  p_content text,
  p_model text default null,
  p_tokens integer default null,
  p_thinking text default null,
  p_steps jsonb default '[]'::jsonb
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

  -- The work record is validated here rather than trusted from the caller: a
  -- JSON object where an array belongs would break every reader downstream.
  if p_steps is not null and jsonb_typeof(p_steps) <> 'array' then
    raise exception 'steps must be a JSON array' using errcode = '22023';
  end if;

  if p_steps is not null and jsonb_array_length(p_steps) > 60 then
    raise exception 'a message keeps at most 60 steps' using errcode = '22023';
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
    (chat_id, owner, role, content, model, seq, usage_tokens, thinking, steps)
  values
    (p_chat_id, v_owner, p_role, btrim(p_content), p_model, v_next,
     case when p_tokens is null then null else greatest(p_tokens, 0) end,
     nullif(btrim(coalesce(p_thinking, '')), ''),
     coalesce(p_steps, '[]'::jsonb))
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

revoke all on function public.append_message(uuid, text, text, text, integer, text, jsonb)
  from public, anon;
grant execute on function public.append_message(uuid, text, text, text, integer, text, jsonb)
  to authenticated;
