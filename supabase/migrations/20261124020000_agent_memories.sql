-- Per-agent long-term memory (#135): a memory with agent_id is visible only in that agent's conversation (null = shared by the workspace).
-- Same owner-only RLS as before; gone with the agent.
alter table public.workspace_memories add column agent_id uuid references public.agents (id) on delete cascade;
create index on public.workspace_memories (agent_id);
