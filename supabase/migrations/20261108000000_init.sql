-- Log Tax base schema. Every table is scoped by workspace and protected by RLS.
-- v1: only the workspace owner writes; members (reader/commenter) read. Invites arrive in the sharing ticket.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('empresa', 'pessoal')),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'commenter', 'reader')),
  primary key (workspace_id, user_id)
);

create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  data jsonb not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  objective text not null,
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  rule jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  storage_path text,
  doc_type text,
  extracted jsonb,
  created_at timestamptz not null default now()
);

create index on public.workspace_members (user_id);
create index on public.dashboards (workspace_id);
create index on public.agents (workspace_id);
create index on public.alerts (workspace_id);
create index on public.documents (workspace_id);

-- Membership helpers. SECURITY DEFINER avoids recursive RLS on workspace_members.
create function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members where workspace_id = ws and user_id = (select auth.uid())
  );
$$;

create function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

-- The creator becomes the owner member automatically.
create function public.add_owner_member() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger workspaces_add_owner after insert on public.workspaces
  for each row execute function public.add_owner_member();

-- No anonymous access to anything.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_member(uuid), public.is_owner(uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.dashboards enable row level security;
alter table public.agents enable row level security;
alter table public.alerts enable row level security;
alter table public.documents enable row level security;

-- owner_id is checked too so INSERT ... RETURNING works before the membership trigger is visible.
create policy workspaces_select on public.workspaces for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_member(id));
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id) and owner_id = (select auth.uid()));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (public.is_owner(id));

-- Members: read-only for users; writes happen through the owner trigger / future invite function.
create policy members_select on public.workspace_members for select to authenticated
  using (public.is_member(workspace_id));

-- Content tables: members read, owner writes.
create policy dashboards_select on public.dashboards for select to authenticated using (public.is_member(workspace_id));
create policy dashboards_write on public.dashboards for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

create policy agents_select on public.agents for select to authenticated using (public.is_member(workspace_id));
create policy agents_write on public.agents for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

create policy alerts_select on public.alerts for select to authenticated using (public.is_member(workspace_id));
create policy alerts_write on public.alerts for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

create policy documents_select on public.documents for select to authenticated using (public.is_member(workspace_id));
create policy documents_write on public.documents for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
