-- Auto is a model in the picker, and an hour on it costs the catalogue default.
--
-- Migration 025 taught `model_hour_dew` the two concrete models and priced an
-- unlisted id at 2. Auto is listed now, so the same number is written down here
-- instead of being left to the `else`: a future change to what an Auto hour
-- costs has to change this function, exactly like the other two. The body is
-- otherwise identical, so applying this after 025 changes no price.
--
-- Why a new file rather than an edit: 025 is already applied somewhere, and an
-- edited applied migration is drift, not a fix.

create or replace function public.model_hour_dew(p_model text)
returns numeric
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_model, '')))
    when 'auto' then 2::numeric
    when 'gpt-oss-120b' then 2::numeric
    when 'deepseek-flash' then 2::numeric
    -- A model this function has not been taught costs the catalogue default, so
    -- an unlisted CUSTOM_MODELS entry can never become a free hour.
    else 2::numeric
  end;
$$;

revoke all on function public.model_hour_dew(text) from public, anon;
grant execute on function public.model_hour_dew(text) to authenticated;
