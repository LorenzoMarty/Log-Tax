-- Background jobs in Postgres (no extra service): a table, idempotent enqueue, claim with SKIP LOCKED,
-- retry with exponential backoff. Only the service role touches it; users never see it.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}',
  -- Same key, same job: enqueueing twice never duplicates the work.
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on public.jobs (status, run_at);
alter table public.jobs enable row level security;
-- no policies: invisible to users

create function public.enqueue_job(p_type text, p_payload jsonb, p_key text, p_run_at timestamptz default now(), p_max_attempts integer default 5)
returns uuid
language sql
security definer
set search_path = public
as $$
  with ins as (
    insert into public.jobs (type, payload, idempotency_key, run_at, max_attempts)
    values (p_type, coalesce(p_payload, '{}'), p_key, p_run_at, p_max_attempts)
    on conflict (idempotency_key) do nothing
    returning id
  )
  select id from ins;
$$;

-- Takes up to p_limit due jobs (and jobs whose worker died more than 10 minutes ago) and marks them running.
create function public.claim_jobs(p_limit integer default 10)
returns setof public.jobs
language sql
security definer
set search_path = public
as $$
  update public.jobs j
     set status = 'running', attempts = j.attempts + 1, locked_at = now()
   where j.id in (
     select id from public.jobs
      where (status = 'queued' and run_at <= now())
         or (status = 'running' and locked_at < now() - interval '10 minutes')
      order by run_at
      limit p_limit
        for update skip locked
   )
  returning j.*;
$$;

create function public.complete_job(p_id uuid) returns void
language sql
security definer
set search_path = public
as $$
  update public.jobs set status = 'done', finished_at = now(), locked_at = null, last_error = null where id = p_id;
$$;

-- A failed attempt is retried after 2^attempts minutes until max_attempts, then the job is parked as failed.
create function public.fail_job(p_id uuid, p_error text) returns void
language sql
security definer
set search_path = public
as $$
  update public.jobs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         run_at = case when attempts >= max_attempts then run_at else now() + make_interval(mins => power(2, attempts)::integer) end,
         finished_at = case when attempts >= max_attempts then now() else null end,
         locked_at = null,
         last_error = left(p_error, 500)
   where id = p_id;
$$;

-- What the operations dashboard reads.
create view public.job_status with (security_invoker = true) as
  select type, status, count(*) as jobs, max(attempts) as max_attempts_used, min(run_at) filter (where status = 'queued') as next_run_at
    from public.jobs group by type, status;

-- Housekeeping used by the first real job: drop rate-limit buckets older than a day.
create function public.purge_rate_limits() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.enqueue_job(text, jsonb, text, timestamptz, integer), public.claim_jobs(integer), public.complete_job(uuid), public.fail_job(uuid, text), public.purge_rate_limits() from public, anon, authenticated;
grant execute on function public.enqueue_job(text, jsonb, text, timestamptz, integer), public.claim_jobs(integer), public.complete_job(uuid), public.fail_job(uuid, text), public.purge_rate_limits() to service_role;
revoke all on public.job_status from public, anon, authenticated;
grant select on public.job_status to service_role;
