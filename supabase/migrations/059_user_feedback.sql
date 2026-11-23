-- User feedback: bug/problem reports (with optional screenshot upload) and
-- feature suggestions, reviewable by operators in /admin/feedback.
--
-- Security model:
--   1. `user_feedback` has RLS enabled. Members can read only their own rows
--      (`owner = auth.uid()`).
--   2. Inserts go through `submit_user_feedback` (security definer), which
--      enforces signed-in ownership, validates `kind`, caps open items per
--      account, and verifies that any attached screenshot path starts with
--      `${uid}/`.
--   3. Status/note updates go through `review_user_feedback` (security definer),
--      which re-checks `is_admin()` inside Postgres.
--   4. Screenshots are stored in the private `feedback` storage bucket (or fell
--      back to `receipts` if `feedback` is missing) under `${uid}/<uuid>.<ext>`.

create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('bug', 'suggestion')),
  category text not null default 'general',
  title text not null,
  description text not null,
  page_url text,
  image_path text,
  image_name text,
  image_type text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'planned', 'closed')),
  admin_note text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_feedback_kind_status_created_idx
  on public.user_feedback (kind, status, created_at desc);

create index if not exists user_feedback_owner_created_idx
  on public.user_feedback (owner, created_at desc);

drop trigger if exists user_feedback_touch_updated_at
  on public.user_feedback;
create trigger user_feedback_touch_updated_at
  before update on public.user_feedback
  for each row execute function public.touch_updated_at();

alter table public.user_feedback enable row level security;

drop policy if exists "user_feedback: owner reads" on public.user_feedback;
create policy "user_feedback: owner reads"
  on public.user_feedback for select to authenticated
  using (owner = auth.uid());

revoke all on public.user_feedback from anon, authenticated;
grant select on public.user_feedback to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.user_feedback to service_role;
  end if;
end $$;

create or replace function public.submit_user_feedback(
  p_kind text,
  p_category text,
  p_title text,
  p_description text,
  p_page_url text default null,
  p_image_path text default null,
  p_image_name text default null,
  p_image_type text default null
)
returns table (id uuid, status text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_category text := lower(btrim(coalesce(p_category, 'general')));
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_page_url text := nullif(left(btrim(coalesce(p_page_url, '')), 300), '');
  v_path text := nullif(btrim(coalesce(p_image_path, '')), '');
  v_name text := nullif(left(btrim(coalesce(p_image_name, '')), 200), '');
  v_type text := nullif(left(btrim(coalesce(p_image_type, '')), 80), '');
  v_open_count integer;
  v_row public.user_feedback;
begin
  if v_uid is null then
    raise exception 'feedback: not signed in' using errcode = '28000';
  end if;

  if v_kind <> all (array['bug', 'suggestion']) then
    raise exception 'feedback: choose bug or suggestion' using errcode = '22023';
  end if;

  if v_category = '' or length(v_category) > 40 then
    v_category := 'general';
  end if;

  if length(v_title) < 3 or length(v_title) > 160 then
    raise exception 'feedback: enter a short title (3–160 characters)'
      using errcode = '22023';
  end if;

  if length(v_description) < 10 or length(v_description) > 4000 then
    raise exception 'feedback: describe the details (10–4000 characters)'
      using errcode = '22023';
  end if;

  if v_path is not null and v_path not like v_uid::text || '/%' then
    raise exception 'feedback: invalid screenshot path'
      using errcode = '22023';
  end if;

  select count(*) into v_open_count
    from public.user_feedback f
   where f.owner = v_uid
     and f.status = 'open';

  if v_open_count >= 25 then
    raise exception 'feedback: too many open submissions'
      using errcode = 'P0001';
  end if;

  insert into public.user_feedback (
    owner,
    kind,
    category,
    title,
    description,
    page_url,
    image_path,
    image_name,
    image_type
  )
  values (
    v_uid,
    v_kind,
    v_category,
    v_title,
    v_description,
    v_page_url,
    v_path,
    v_name,
    v_type
  )
  returning * into v_row;

  return query select v_row.id, v_row.status, v_row.created_at;
end;
$$;

revoke all on function public.submit_user_feedback(
  text, text, text, text, text, text, text, text
) from public, anon;
grant execute on function public.submit_user_feedback(
  text, text, text, text, text, text, text, text
) to authenticated;

create or replace function public.review_user_feedback(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns table (id uuid, status text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_row public.user_feedback;
begin
  if not public.is_admin() then
    raise exception 'admin: not allowed' using errcode = '42501';
  end if;

  if v_status <> all (array['open', 'in_progress', 'resolved', 'planned', 'closed']) then
    raise exception 'feedback: invalid status' using errcode = '22023';
  end if;

  update public.user_feedback f
     set status = v_status,
         admin_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where f.id = p_id
  returning * into v_row;

  if not found then
    raise exception 'feedback: submission not found' using errcode = 'P0002';
  end if;

  return query select v_row.id, v_row.status, v_row.updated_at;
end;
$$;

revoke all on function public.review_user_feedback(uuid, text, text)
  from public, anon;
grant execute on function public.review_user_feedback(uuid, text, text)
  to authenticated;

-- Private storage bucket for bug report screenshots, with owner-read policy.
do $$
begin
  if exists (
    select 1 from information_schema.schemata where schema_name = 'storage'
  ) then
    insert into storage.buckets (id, name, public)
    values ('feedback', 'feedback', false)
    on conflict (id) do nothing;

    if not exists (
      select 1 from pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and policyname = 'feedback: owner reads'
    ) then
      create policy "feedback: owner reads" on storage.objects
        for select to authenticated
        using (
          bucket_id = 'feedback'
          and (storage.foldername(name))[1] = auth.uid()::text
        );
    end if;
  end if;
end;
$$;
