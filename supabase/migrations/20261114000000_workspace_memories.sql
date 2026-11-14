-- Long-term memory of the assistant (#113): short facts and preferences the user asked it to remember, per workspace.
-- Owner only: a guest of a shared space never reads or writes what the owner told the assistant. Gone with the workspace.
create table public.workspace_memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  created_at timestamptz not null default now()
);
create index on public.workspace_memories (workspace_id, created_at);

revoke all on public.workspace_memories from anon;
alter table public.workspace_memories enable row level security;
create policy workspace_memories_owner on public.workspace_memories for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
