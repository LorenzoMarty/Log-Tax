-- Each AI agent can keep its own dashboard (#139). agent_id null = the workspace's main dashboard.
-- Composite FK: the agent must belong to the same workspace; deleting the agent deletes its panel.
alter table public.dashboards add column agent_id uuid;
alter table public.dashboards add constraint dashboards_agent_fk
  foreign key (agent_id, workspace_id) references public.agents (id, workspace_id) on delete cascade;
create unique index dashboards_one_per_agent on public.dashboards (agent_id) where agent_id is not null;
