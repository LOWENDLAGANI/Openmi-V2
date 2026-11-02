-- Phase 3: the message append path.
--
-- `seq` orders a transcript. `created_at` does not: two inserts in the same
-- millisecond, or a clock that steps backwards, would reorder a conversation
-- for one device and not the other. The sequence is assigned here, under a lock
-- on the chat row, so two concurrent appends cannot pick the same number.
--
-- `security invoker` is deliberate. The function is a convenience, not an
-- authority: the insert still runs as the caller and still has to satisfy the
-- messages policies, and the chat lookup only finds a chat the caller owns.

create or replace function public.append_message(
  p_chat_id uuid,
  p_role text,
  p_content text,
  p_model text default null
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

  insert into public.messages (chat_id, owner, role, content, model, seq)
  values (p_chat_id, v_owner, p_role, btrim(p_content), p_model, v_next)
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

revoke all on function public.append_message(uuid, text, text, text) from anon;
grant execute on function public.append_message(uuid, text, text, text) to authenticated;
