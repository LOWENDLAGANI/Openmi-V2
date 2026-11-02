-- Phase 9: one rate limiter, shared by every instance.
--
-- Vercel runs several instances, so an in-memory Map is not a limiter: two
-- requests that land on different instances would each see a fresh count. This
-- table is the counter, and `rate_limit_hit` is the only way to move it.
--
-- The increment and the cap check are one statement. `on conflict do update ...
-- where hits < p_max` either increments and returns the new count, or matches
-- no row, which is how a caller learns it is over the cap without a read-then-
-- write race. Two instances calling at once cannot both be the fifth hit.
--
-- The table is service-role only: no grants, no policies. A client cannot read
-- another account's bucket names or reset its own count.
--
-- Without this table (or with Upstash configured instead) the caller degrades to
-- allowing the request, and says so. A rate limiter that fails closed turns a
-- database hiccup into an outage.

create table if not exists public.rate_limits (
  bucket text not null check (length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);

create index if not exists rate_limits_window_idx
  on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;

-- No policy and no grant: only the service role and the function below reach it.
revoke all on public.rate_limits from anon, authenticated;

/**
 * Counts one hit in `p_bucket` for the window starting at `p_window_start`.
 * Returns whether the hit was allowed and the count after it (capped at max).
 */
create or replace function public.rate_limit_hit(
  p_bucket text,
  p_window_start timestamptz,
  p_max integer
)
returns table (allowed boolean, hits integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
  v_bucket text := left(btrim(coalesce(p_bucket, '')), 200);
begin
  if p_max is null or p_max < 1 then
    raise exception 'rate: max must be at least 1' using errcode = '22023';
  end if;

  if v_bucket = '' then
    raise exception 'rate: bucket is required' using errcode = '22023';
  end if;

  insert into public.rate_limits as r (bucket, window_start, hits)
  values (v_bucket, p_window_start, 1)
  on conflict (bucket, window_start) do update
     set hits = r.hits + 1
   where r.hits < p_max
  returning r.hits into v_hits;

  if v_hits is null then
    -- Over the cap. The row keeps its last count; the caller reports the limit.
    return query select false, p_max;
    return;
  end if;

  return query select true, v_hits;
end;
$$;

revoke all on function public.rate_limit_hit(text, timestamptz, integer)
  from public, anon, authenticated;

-- The role is absent on a bare Postgres (the migration harness), so the grant is
-- conditional rather than an error there.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.rate_limit_hit(text, timestamptz, integer)
      to service_role;
  end if;
end
$$;
