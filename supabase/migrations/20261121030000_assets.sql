-- Assets of a workspace (#180): property, vehicles, investments... added through the conversation.
-- Members read, only the owner writes (like alerts). Gone with the workspace. `extra` holds per-kind details.
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('imovel', 'veiculo', 'investimento', 'participacao', 'bem', 'divida')),
  description text not null check (char_length(description) between 1 and 200),
  value numeric(16, 2) not null check (value >= 0),
  acquired_at date,
  extra jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  created_at timestamptz not null default now()
);
create index on public.assets (workspace_id, created_at);

revoke all on public.assets from anon;
alter table public.assets enable row level security;
create policy assets_select on public.assets for select to authenticated using (public.is_member(workspace_id));
create policy assets_write on public.assets for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
