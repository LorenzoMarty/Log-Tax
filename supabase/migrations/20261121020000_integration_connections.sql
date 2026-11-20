-- Integration connections (#167): one row per provider per workspace. The credentials are sealed by the API (AES-GCM, see
-- app/core/crypto.py) before they get here; disconnecting deletes the row, and the credential with it. Owner only.
create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9_]{1,40}$'),
  status text not null default 'active' check (status in ('active', 'error')),
  credentials text not null,
  last_sync_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

revoke all on public.integration_connections from anon;
alter table public.integration_connections enable row level security;
create policy integration_connections_owner on public.integration_connections for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
