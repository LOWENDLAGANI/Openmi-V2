-- Phase 11: history is a list of conversations, not of clicks.
--
-- Creating a chat used to insert a row immediately, so every tap on "New chat"
-- left an empty conversation in the sidebar even when nothing was sent. New
-- chats are now created on the first message. This migration gives the sidebar
-- a cheap, indexed way to tell a conversation from a leftover: a chat is in the
-- history when it has at least one message.
--
-- Existing rows are backfilled from their messages, so a chat that already has
-- a conversation stays visible. Rows with no messages stay in the database but
-- are no longer listed, which is the honest fix for data created by the old
-- behaviour: nothing is deleted.

alter table public.chats
  add column if not exists last_message_at timestamptz;

create index if not exists chats_owner_last_message_idx
  on public.chats (owner, last_message_at desc nulls last);

update public.chats c
   set last_message_at = recent.last_at
  from (
    select chat_id, max(created_at) as last_at
      from public.messages
     group by chat_id
  ) recent
 where recent.chat_id = c.id
   and c.last_message_at is null;

/**
 * Stamps the chat when a message is appended.
 *
 * A trigger rather than another line in `append_message`: the function is
 * already the authority on `seq`, and a trigger covers every write path,
 * including a future one. `security invoker` keeps the RLS update policy in
 * force, and the owner filter turns a policy regression into a no-op.
 */
create or replace function public.touch_chat_last_message()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.chats
     set last_message_at = new.created_at
   where id = new.chat_id
     and owner = auth.uid();

  return new;
end;
$$;

drop trigger if exists messages_touch_chat on public.messages;
create trigger messages_touch_chat
  after insert on public.messages
  for each row execute function public.touch_chat_last_message();
