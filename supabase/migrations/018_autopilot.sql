-- Autopilot, per chat, off by default.
--
-- With it on, a turn that proposes a changeset does not stop at the review card:
-- the run applies the files in a sandbox, builds, asks the model to repair what
-- failed, and — only if the build really exits 0 — opens the pull request that
-- approval would otherwise have opened by hand.
--
-- It changes who approves, not what is written: still one `openmi/agent/`
-- branch, still one pull request, still never the default branch. The column
-- lives on the chat rather than the account because "finish this and push it"
-- is a decision about one conversation, not a global preference.
--
-- Off by default is the part that matters. A deployment that never sets this
-- behaves exactly as it did before the column existed.

alter table public.chats
  add column if not exists autopilot boolean not null default false;

comment on column public.chats.autopilot is
  'When true, a finished turn verifies its changeset in a sandbox and opens the pull request automatically.';
