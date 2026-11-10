-- Fixed-window request counters, kept in Postgres (no extra service). The table is private: RLS on, no policies,
-- so it is reachable only through rate_limit_hit().
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);
alter table public.rate_limits enable row level security;

-- Counts one hit on `p_key` and returns 0 when allowed, or the seconds to wait when the limit is exceeded.
-- A key must belong to the caller ("<uid>:...") or be an IP bucket ("ip:..."), so nobody can burn another user's budget.
create function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_hits integer;
  v_start timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_key not like auth.uid()::text || ':%' and p_key not like 'ip:%' then
    raise exception 'invalid rate limit key';
  end if;

  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_now, 1)
  on conflict (key) do update set
    window_start = case when r.window_start + make_interval(secs => p_window_seconds) <= v_now then v_now else r.window_start end,
    hits = case when r.window_start + make_interval(secs => p_window_seconds) <= v_now then 1 else r.hits + 1 end
  returning r.hits, r.window_start into v_hits, v_start;

  if v_hits > p_limit then
    return greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - v_now)))::integer);
  end if;
  return 0;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon;
grant execute on function public.rate_limit_hit(text, integer, integer) to authenticated;
