-- Phase 8: the setup page's view of what has actually been applied.
--
-- PostgREST does not expose the `supabase_migrations` schema, so the setup page
-- cannot select that table. This security-definer function returns the ledger
-- rows it needs, and is executable by the service role only. It never returns a
-- secret: versions, names and the SQL statements the CLI recorded.
--
-- The ledger's statements are checksummed in the application against local
-- files. A file edited after it was applied therefore shows as drift rather
-- than as up to date.
--
-- This migration also grants the phase-7 operator correction function to the
-- service role. That function was revoked from everything by default; Supabase's
-- service role is not the function owner, so without this grant an operator
-- could not call it through the API.

create or replace function public.openmi_migration_ledger()
returns table (version text, name text, statements text[])
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select m.version, m.name, m.statements
      from supabase_migrations.schema_migrations m
     order by m.version;
exception
  when undefined_table or invalid_schema_name then
    -- A database without the Supabase CLI ledger is not an outage: the setup
    -- page reports an empty ledger rather than failing to render.
    return;
end;
$$;

revoke all on function public.openmi_migration_ledger() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.openmi_migration_ledger() to service_role;
    grant execute on function public.operator_adjust_dew(uuid, numeric, text) to service_role;
  end if;
end
$$;
