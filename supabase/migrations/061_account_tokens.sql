-- ── How many tokens an account has spent, in one number ─────────────────────
--
-- The activity page could only show usage per chat, over the last thousand
-- messages. That is a window, not a total, so it could not answer "how many
-- tokens has this account used". This stores the running total on the profile:
-- one bigint, incremented by the trigger below every time a message records its
-- estimate — whichever writer appended it (`append_message`,
-- `append_worker_message`, or a direct insert).
--
-- Only the number is stored. `messages.usage_tokens` remains the detail behind
-- it, and deleting a chat does not reduce the total: those tokens were spent.

alter table public.profiles
  add column if not exists tokens_used bigint not null default 0;

-- Backfill from what is already recorded, so the figure is true on the first
-- read rather than starting at zero. Rows that already have a total are left
-- alone: the sum of the surviving messages is not the same as what was spent
-- once a chat has been deleted.
update public.profiles p
   set tokens_used = coalesce(
     (select sum(m.usage_tokens) from public.messages m where m.owner = p.id),
     0
   )
 where p.tokens_used = 0;

create or replace function public.add_message_tokens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.usage_tokens is not null and new.usage_tokens > 0 then
    update public.profiles
       set tokens_used = coalesce(tokens_used, 0) + new.usage_tokens
     where id = new.owner;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_add_tokens on public.messages;
create trigger messages_add_tokens
  after insert on public.messages
  for each row
  execute function public.add_message_tokens();

-- The trigger runs the function; no client role needs to call it.
revoke all on function public.add_message_tokens() from public;
