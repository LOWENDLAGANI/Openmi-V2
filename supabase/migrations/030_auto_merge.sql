-- Applying a change, and undoing it.
--
-- An approval now applies itself: the server squash-merges the pull request it
-- opened and records the resulting commit. `merge_commit_sha` is the receipt for
-- that, and it is also the proof an undo needs — a row without it was never
-- applied, so there is nothing to restore.
--
-- `reverted_commit_sha` is the receipt for the undo commit. `reverted` joins the
-- status values so a card can say "undone" rather than inferring it from a
-- column, and `failed` keeps meaning a change that could not be applied.
--
-- No policy changes: both columns are written through the same owner-scoped
-- update the rest of the row uses.

alter table public.changesets
  add column if not exists merge_commit_sha text,
  add column if not exists reverted_commit_sha text;

alter table public.changesets
  drop constraint if exists changesets_status_check;

alter table public.changesets
  add constraint changesets_status_check
  check (status in (
    'draft', 'ready', 'approved', 'committed', 'failed', 'expired', 'reverted'
  ));
