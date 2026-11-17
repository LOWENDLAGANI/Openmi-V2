-- ── The thinking effort a turn asked for ────────────────────────────────────
--
-- DeepSeek's V4.1 flash takes three thinking efforts (lib/models/effort.ts). The
-- choice belongs to a run, not to a chat: it travels with the message that asked
-- for it and the worker reads it back before its first request, so every step of
-- one turn is priced and paced the same way.
--
-- A null effort — every row written before this migration — is not "unknown": it
-- is the provider's own default, which the worker applies without inventing a
-- level. The column is nullable for exactly that reason.
--
-- The constraint is added under a guard so this file applies twice cleanly, the
-- same way 043 guards its grants.

alter table public.runs add column if not exists effort text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'runs_effort_allowed'
       and conrelid = 'public.runs'::regclass
  ) then
    alter table public.runs
      add constraint runs_effort_allowed
      check (effort is null or effort in ('fast', 'high', 'max'));
  end if;
end
$$;
