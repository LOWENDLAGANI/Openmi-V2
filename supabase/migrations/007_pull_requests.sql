-- Phase 6: the pull request a committed changeset opened.
--
-- These columns are a receipt from GitHub, not a plan. They are written only
-- after the API returns each value, so the review card can link out only when a
-- pull request actually exists. `failure` records the last write error and is
-- what makes a retry a resumable act rather than a guess.
--
-- No new policy is needed: the rows are already owner-only, and a status can
-- only reach 'committed' through the same RLS-scoped update. The pull request
-- itself lives on `openmi/agent/<changeset-id>`; the default branch is never a
-- writable ref in the application.

alter table public.changesets
  add column if not exists branch_name text,
  add column if not exists commit_sha text,
  add column if not exists pr_url text,
  add column if not exists pr_number integer,
  add column if not exists approved_at timestamptz,
  add column if not exists failure text;
