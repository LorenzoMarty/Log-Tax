-- Product funnel events. Deliberately no payload column: an event is only who (opaque id), which step, and when.
-- Recorded only for people who opted in (consent purpose 'analytics').
alter table public.consents drop constraint consents_purpose_check;
alter table public.consents add constraint consents_purpose_check check (purpose in ('documents', 'analytics'));

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event text not null check (event in ('signed_in', 'workspace_created', 'first_diagnosis', 'opportunities_viewed', 'simulated', 'alert_created', 'agent_created')),
  created_at timestamptz not null default now()
);
create index on public.product_events (event, created_at);
alter table public.product_events enable row level security;
-- no policies: written through track_event(), read by the service role (admin funnel)

create function public.track_event(p_event text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_consent('analytics') then
    return; -- no consent, no event
  end if;
  insert into public.product_events (user_id, event) values (auth.uid(), p_event);
end;
$$;
revoke all on function public.track_event(text) from public, anon;
grant execute on function public.track_event(text) to authenticated;

-- The journey in order: how many distinct people reached each step.
create view public.product_funnel with (security_invoker = true) as
  select event, count(distinct user_id) as people
    from public.product_events group by event;
revoke all on public.product_funnel from public, anon, authenticated;
grant select on public.product_funnel to service_role;

-- Lets the test suite prove the events table has no payload column.
create function public.columns_of(p_table text) returns text[]
language sql stable security definer set search_path = ''
as $$
  select array_agg(column_name::text order by column_name) from information_schema.columns where table_schema = 'public' and table_name = p_table;
$$;
revoke all on function public.columns_of(text) from public, anon, authenticated;
grant execute on function public.columns_of(text) to service_role;
