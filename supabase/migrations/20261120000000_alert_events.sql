-- Alerts evaluated on a schedule, without anyone opening the app (#145).
-- `alerts.fired` remembers whether the alert is over its limit right now: a notice is recorded only when it turns from false to
-- true, and it is armed again when it turns back, so running the job twice never repeats a notice.
alter table public.alerts add column fired boolean not null default false;

create table public.alert_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  alert_id uuid not null references public.alerts (id) on delete cascade,
  -- The rule in plain Portuguese and the value that tripped it, as the panel writes them.
  text text not null,
  current_text text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index on public.alert_events (workspace_id, created_at desc);

revoke all on public.alert_events from anon;
alter table public.alert_events enable row level security;
-- Anyone with access to the workspace sees its notices; only the owner marks them read.
-- No insert policy: notices are written by the scheduled job (service role), never by a user.
create policy alert_events_read on public.alert_events for select to authenticated
  using (public.is_member(workspace_id));
create policy alert_events_mark_read on public.alert_events for update to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
