-- Chat state: company profile on the workspace, plus one conversation per workspace.

alter table public.workspaces add column profile jsonb;

create table public.conversations (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  -- Provider-native transcript replayed to the model (store:false on the provider side).
  history jsonb not null default '[]',
  -- What the user sees: [{ role, text }].
  messages jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

revoke all on public.conversations from anon;
alter table public.conversations enable row level security;

create policy conversations_select on public.conversations for select to authenticated
  using (public.is_member(workspace_id));
create policy conversations_write on public.conversations for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
