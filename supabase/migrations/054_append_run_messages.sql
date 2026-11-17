-- ── One write for a run's opening transcript ────────────────────────────────
--
-- A chat turn hands the worker the tail of the conversation before the run is
-- queued. That used to be one `append_run_message` call per row — up to twelve
-- sequential round trips between the request arriving and the first byte of an
-- answer being able to leave the server.
--
-- This is the same insert, in the same order, in one call. The index is still
-- chosen here, by the same max-plus-one rule, so concurrent appends cannot
-- collide; order is what makes a transcript a transcript, so the rows arrive as
-- a JSON array and are numbered in that order.

create or replace function public.append_run_messages(p_run uuid, p_messages jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_idx   integer;
  v_item  jsonb;
  v_role  text;
  v_count integer := 0;
begin
  select owner into v_owner from public.runs where id = p_run;
  if v_owner is null then
    raise exception 'run % does not exist', p_run;
  end if;

  select coalesce(max(idx), 0) into v_idx
    from public.run_messages
   where run_id = p_run;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb))
  loop
    v_role := v_item ->> 'role';

    -- An unknown role would violate the table's check constraint, and one bad
    -- row must not throw away the rest of a transcript.
    if v_role is null or v_role not in ('user', 'assistant', 'tool', 'system') then
      continue;
    end if;

    v_idx := v_idx + 1;
    v_count := v_count + 1;

    insert into public.run_messages (run_id, owner, idx, role, content_json, tags)
    values (
      p_run,
      v_owner,
      v_idx,
      v_role,
      coalesce(v_item -> 'content', '{}'::jsonb),
      array(
        select t.value
          from jsonb_array_elements_text(
            coalesce(v_item -> 'tags', '[]'::jsonb)
          ) as t(value)
      )
    );
  end loop;

  return v_count;
end;
$$;

revoke all on function public.append_run_messages(uuid, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.append_run_messages(uuid, jsonb) to service_role;
  end if;
end
$$;
