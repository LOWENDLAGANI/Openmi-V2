--
-- The operator-only model, and the hour it costs.
--
-- `gpt-6-luna` is served through the Experiential gateway and shown only to an
-- operator account. The price is the catalogue default, written down here for
-- the same reason 041 and 051 wrote theirs: a model the picker lists should not
-- depend on the `else` branch for its number, so a change to what an unlisted id
-- costs cannot quietly reprice a listed one. Behavior is otherwise identical to
-- 051, including the paid-only gate, which this file does not touch.
--
-- Applying this changes no price and no gate. A deployment that never applies it
-- still charges 3 Dew, because the `else` says so; what it loses is the record of
-- the decision.
--
-- A new file rather than an edit to 051: an edited applied migration is drift.

create or replace function public.model_hour_dew(p_model text)
returns numeric
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_model, '')))
    when 'auto' then 0::numeric
    when 'deepseek-flash' then 3::numeric
    when 'claude-haiku' then 3::numeric
    when 'gpt-6-luna' then 3::numeric
    -- A model this function has not been taught costs the catalogue default.
    else 3::numeric
  end;
$$;

revoke all on function public.model_hour_dew(text) from public, anon;
grant execute on function public.model_hour_dew(text) to authenticated;

insert into public.openmi_meta (key, value)
values ('experiential_gateway', '1')
on conflict (key) do update set value = excluded.value;
