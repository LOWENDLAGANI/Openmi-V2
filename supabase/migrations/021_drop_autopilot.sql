-- The autopilot switch is gone.
--
-- 018 added a per-chat opt-in for "build it, repair it, and open a pull request
-- only if it exits 0". That behaviour is now the default for every ready diff,
-- so a column that can only ever be true would be a second source of truth.
-- Dropping it makes the absence explicit; 018 stays in the ledger as history.

alter table public.chats drop column if exists autopilot;
