-- Why a preview stopped, when the reason was not the reader.
--
-- A preview that disappears without a sentence reads as a bug. The limit that
-- stopped it (sixty minutes of lifetime, a quarter of an hour with nobody
-- looking) is recorded here so the panel can say which one, and so restarting is
-- an informed choice rather than a guess.
--
-- Nullable: a manual stop, or a preview that has never run, has no reason to
-- give. Additive and idempotent, so the migration applies twice cleanly.

alter table public.chat_previews
  add column if not exists stop_reason text;

comment on column public.chat_previews.stop_reason is
  'Why the preview stopped when a limit ended it, phrased for the panel.';
