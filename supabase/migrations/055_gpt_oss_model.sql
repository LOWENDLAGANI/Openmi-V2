-- ── GPT-OSS joins the catalogue ─────────────────────────────────────────────
--
-- `gpt-oss` is OpenAI's open-weight model, served through Straitly (see
-- lib/models/routes.ts). The hour it opens costs what every named model costs,
-- and this is written out rather than left to the `else` so the picker and the
-- charge cannot drift: tests/credit.test.ts reads this definition and requires
-- a case for every catalogue entry.
--
-- The function's signature, language and volatility are unchanged from 053; it
-- is replaced rather than dropped, so the grants and the callers stay as they
-- are.

create or replace function public.model_hour_credit(p_model text)
returns numeric
language sql
immutable
as $function$
  select case lower(btrim(coalesce(p_model, '')))
    when 'auto' then 0::numeric
    when 'deepseek-flash' then 3::numeric
    when 'claude-haiku' then 3::numeric
    when 'gpt-oss' then 3::numeric
    when 'gpt-6-luna' then 3::numeric
    -- A model this function has not been taught costs the catalogue default.
    else 3::numeric
  end;
$function$;

revoke all on function public.model_hour_credit(p_model text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.model_hour_credit(p_model text) to authenticated;
  end if;
end
$$;
