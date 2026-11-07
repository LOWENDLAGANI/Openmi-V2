-- Chat workspaces run on E2B.
--
-- `024` widened the column for orkestr. The provider is a record of what
-- created a box, not a security boundary, and nothing branches on it, so this
-- is the same constraint swap: existing rows keep their value, and a row
-- inserted from now on is created by the provider the code is configured for.
--
-- 'orkestr' stays in the allowed set because rows written before this deploy
-- still point at boxes on it; they are rewritten only when the box is destroyed.

alter table public.chat_sandboxes
  drop constraint if exists chat_sandboxes_provider_check;

alter table public.chat_sandboxes
  add constraint chat_sandboxes_provider_check
  check (provider in ('daytona', 'orkestr', 'e2b'));

alter table public.chat_sandboxes
  alter column provider set default 'e2b';
