-- Looking a suggestion over, and discarding it.
--
-- `reviewed_at` records that the reader chose "Review first": the change stays
-- ready, but the apply dialog knows it has been seen and stops asking. A null
-- value means nobody has looked at it yet, which is one of the reasons the
-- dialog appears.
--
-- `rejected` joins the status values so "Cancel" is a recorded outcome rather
-- than a deleted row: the AI may propose again, and the history of what was
-- discarded stays readable.
--
-- No policy changes: both are written through the same owner-scoped update the
-- rest of the row uses.

alter table public.changesets
  add column if not exists reviewed_at timestamptz;

alter table public.changesets
  drop constraint if exists changesets_status_check;

alter table public.changesets
  add constraint changesets_status_check
  check (status in (
    'draft', 'ready', 'approved', 'committed', 'failed', 'expired', 'reverted',
    'rejected'
  ));
