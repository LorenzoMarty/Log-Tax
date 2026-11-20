-- Dashboard version history (#128): one snapshot per saved version, bounded by the app (last 50 per workspace).
-- Members read, only the owner writes. Restoring never edits a row: it appends a new version.
create table public.dashboard_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version int not null check (version >= 1),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  summary text not null check (char_length(summary) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (workspace_id, version)
);

revoke all on public.dashboard_versions from anon;
alter table public.dashboard_versions enable row level security;
create policy dashboard_versions_select on public.dashboard_versions for select to authenticated
  using (public.is_member(workspace_id));
create policy dashboard_versions_write on public.dashboard_versions for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
