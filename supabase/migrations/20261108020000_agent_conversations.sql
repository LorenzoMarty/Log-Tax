-- Each specialised agent has its own conversation, separate from the workspace's general one.

-- Lets agent_conversations prove that the agent really belongs to the workspace it claims.
alter table public.agents add constraint agents_id_workspace_key unique (id, workspace_id);

create table public.agent_conversations (
  agent_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  history jsonb not null default '[]',
  messages jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  foreign key (agent_id, workspace_id) references public.agents (id, workspace_id) on delete cascade
);

revoke all on public.agent_conversations from anon;
alter table public.agent_conversations enable row level security;

create policy agent_conversations_select on public.agent_conversations for select to authenticated
  using (public.is_member(workspace_id));
create policy agent_conversations_write on public.agent_conversations for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
