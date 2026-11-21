-- Share a report by link (#148). The link carries a random token; only its SHA-256 hash is stored, together with a
-- redacted snapshot of the report, so a link opens that snapshot and nothing else (no workspace data, no live queries).
create table public.report_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  opened_count integer not null default 0,
  check (expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index on public.report_shares (workspace_id, created_at desc);

revoke all on public.report_shares from anon, authenticated;
grant select (id, workspace_id, created_by, created_at, expires_at, revoked_at, opened_count) on public.report_shares to authenticated;
grant insert (workspace_id, token_hash, snapshot, expires_at) on public.report_shares to authenticated;
grant update (revoked_at) on public.report_shares to authenticated;
alter table public.report_shares enable row level security;

create policy report_shares_select on public.report_shares for select to authenticated
  using (public.is_owner(workspace_id));
create policy report_shares_insert on public.report_shares for insert to authenticated
  with check (public.is_owner(workspace_id) and created_by = (select auth.uid()));
create policy report_shares_update on public.report_shares for update to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));

-- The only anonymous door: opens one snapshot by token hash. Returns null (unknown, expired or revoked: the same
-- answer on purpose), {"wait": n} when the IP spent its budget, or {"snapshot": ...}. Each open goes to the audit trail.
create function public.read_shared_report(p_hash text, p_ip text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_key text := 'share:ip:' || left(coalesce(p_ip, 'unknown'), 64);
  v_hits integer;
  v_start timestamptz;
  v_share public.report_shares;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (v_key, v_now, 1)
  on conflict (key) do update set
    window_start = case when r.window_start + interval '60 seconds' <= v_now then v_now else r.window_start end,
    hits = case when r.window_start + interval '60 seconds' <= v_now then 1 else r.hits + 1 end
  returning r.hits, r.window_start into v_hits, v_start;
  if v_hits > 30 then
    return jsonb_build_object('wait', greatest(1, ceil(extract(epoch from (v_start + interval '60 seconds' - v_now)))::integer));
  end if;

  select * into v_share from public.report_shares
  where token_hash = p_hash and revoked_at is null and expires_at > v_now;
  if not found then
    return null;
  end if;
  update public.report_shares set opened_count = opened_count + 1 where id = v_share.id;
  insert into public.audit_log (actor_id, actor_email, workspace_id, action, target)
  values (v_share.created_by, null, v_share.workspace_id, 'report_link_opened', v_share.id::text);
  return jsonb_build_object('snapshot', v_share.snapshot);
end;
$$;

revoke all on function public.read_shared_report(text, text) from public;
grant execute on function public.read_shared_report(text, text) to anon, authenticated;
