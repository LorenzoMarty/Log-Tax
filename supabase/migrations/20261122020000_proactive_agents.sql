-- Proactive agents (#138): an agent with `config.schedule` ("daily" | "weekly") gets a notice each period, written by the
-- scheduled job (service role). One notice per agent per period: the unique index makes a second run (or a racing worker)
-- a no-op. `snapshot` keeps the metrics of that run so the next one can say what changed.
alter table public.alert_events
  add column agent_id uuid references public.agents (id) on delete cascade,
  add column period_key text,
  add column snapshot jsonb;
create unique index alert_events_agent_period on public.alert_events (agent_id, period_key)
  where agent_id is not null;
