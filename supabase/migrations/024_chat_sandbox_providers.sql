-- Phase 12 follow-up: chat workspaces run on orkestr.
--
-- `023` pinned the column to the one provider that existed. `provider` records
-- what created a box; it is not a security boundary and nothing branches on it,
-- so widening it is a constraint swap. Existing rows keep 'daytona' — the boxes
-- behind them are still found by id, and a row is only rewritten when its box is
-- destroyed.
--
-- The default moves with the code: a row inserted from now on was created on the
-- provider the deployment is configured for.

alter table public.chat_sandboxes
  drop constraint if exists chat_sandboxes_provider_check;

alter table public.chat_sandboxes
  add constraint chat_sandboxes_provider_check
  check (provider in ('daytona', 'orkestr'));

alter table public.chat_sandboxes
  alter column provider set default 'orkestr';
