-- Per-branch approval preferences.
--
-- One row per account, repository and base branch. A row means: a ready diff on
-- that branch is approved and written without asking again. The application
-- reads this before it opens a pull request; the database only guarantees that
-- a caller can see and change its own rows, so no branch can be auto-approved
-- for somebody else.
--
-- Turning it off is a delete. There is no expiry: this is a standing decision,
-- and the review card shows it with a one-click way back.

create table if not exists public.branch_autoapprovals (
  owner uuid not null references auth.users(id) on delete cascade,
  repo_full_name text not null check (char_length(repo_full_name) between 3 and 200),
  branch text not null check (char_length(branch) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (owner, repo_full_name, branch)
);

create index if not exists branch_autoapprovals_owner_idx
  on public.branch_autoapprovals (owner, repo_full_name);

alter table public.branch_autoapprovals enable row level security;

drop policy if exists "branch_autoapprovals: owner reads" on public.branch_autoapprovals;
create policy "branch_autoapprovals: owner reads"
  on public.branch_autoapprovals for select to authenticated
  using (owner = auth.uid());

drop policy if exists "branch_autoapprovals: owner inserts" on public.branch_autoapprovals;
create policy "branch_autoapprovals: owner inserts"
  on public.branch_autoapprovals for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists "branch_autoapprovals: owner deletes" on public.branch_autoapprovals;
create policy "branch_autoapprovals: owner deletes"
  on public.branch_autoapprovals for delete to authenticated
  using (owner = auth.uid());

revoke all on public.branch_autoapprovals from anon, authenticated;
grant select, insert, delete on public.branch_autoapprovals to authenticated;
