-- Inventory (#183): the estate (one per workspace) and its heirs. Assets and debts reuse public.assets (#180, kind 'divida').
-- Members read, only the owner writes (like assets). Shares must add up to 100% -- checked in the app, since it spans rows.
create table public.estates (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  deceased_name text not null check (char_length(deceased_name) between 1 and 120),
  died_at date not null,
  uf text check (uf is null or uf ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now()
);

create table public.heirs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  relationship text check (relationship is null or char_length(relationship) <= 60),
  share numeric(5, 2) not null check (share > 0 and share <= 100),
  created_at timestamptz not null default now()
);
create index on public.heirs (workspace_id, created_at);

revoke all on public.estates, public.heirs from anon;
alter table public.estates enable row level security;
alter table public.heirs enable row level security;
create policy estates_select on public.estates for select to authenticated using (public.is_member(workspace_id));
create policy estates_write on public.estates for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
create policy heirs_select on public.heirs for select to authenticated using (public.is_member(workspace_id));
create policy heirs_write on public.heirs for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
