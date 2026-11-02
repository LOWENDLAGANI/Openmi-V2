-- Phase 4: the agent turn and its step budget.
--
-- A turn is a row, not a signed blob. The signature on the continuation token
-- proves the token was issued here; the row is what proves the turn may still
-- advance. The compare-and-set in consume_agent_step is the whole point: a
-- caller who replays an older token presents an older `steps` value, the update
-- matches no row, and the replay is refused instead of buying another 24 steps.

create table if not exists public.agent_turns (
  turn_id uuid primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  chat_id uuid not null references public.chats(id) on delete cascade,
  model text not null,
  prompt_hash text not null,
  steps integer not null default 0 check (steps between 0 and 1000),
  max_steps integer not null default 24 check (max_steps between 1 and 1000),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_turns_owner_created_idx
  on public.agent_turns (owner, created_at desc);

create index if not exists agent_turns_chat_idx
  on public.agent_turns (chat_id);

alter table public.agent_turns enable row level security;

drop policy if exists "agent_turns: owner reads" on public.agent_turns;
create policy "agent_turns: owner reads"
  on public.agent_turns for select to authenticated
  using (owner = auth.uid());

drop policy if exists "agent_turns: owner inserts" on public.agent_turns;
create policy "agent_turns: owner inserts"
  on public.agent_turns for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists "agent_turns: owner updates" on public.agent_turns;
create policy "agent_turns: owner updates"
  on public.agent_turns for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

drop policy if exists "agent_turns: owner deletes" on public.agent_turns;
create policy "agent_turns: owner deletes"
  on public.agent_turns for delete to authenticated
  using (owner = auth.uid());

drop trigger if exists agent_turns_touch on public.agent_turns;
create trigger agent_turns_touch
  before update on public.agent_turns
  for each row execute function public.touch_updated_at();

-- Advances the step counter by exactly one, only if the caller's view of the
-- counter is current, the budget is not spent, and the turn has not expired.
-- `security invoker`, so the owner policy still applies on top.
create or replace function public.consume_agent_step(
  p_turn_id uuid,
  p_steps integer
)
returns public.agent_turns
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.agent_turns;
begin
  update public.agent_turns
     set steps = steps + 1,
         updated_at = now()
   where turn_id = p_turn_id
     and owner = auth.uid()
     and steps = p_steps
     and steps < max_steps
     and expires_at > now()
  returning * into v_row;

  if not found then
    raise exception 'step refused: stale, exhausted or expired'
      using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.consume_agent_step(uuid, integer) from anon;
grant execute on function public.consume_agent_step(uuid, integer) to authenticated;
