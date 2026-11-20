-- Platform admin (#201): a role distinct from workspace roles. Rows are added only by migration / service role;
-- no client role can read or write the table. Admin reads go through security-definer functions that return
-- aggregates only (never message or document content) and append an audit row on every call.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
revoke all on public.platform_admins from anon, authenticated;
alter table public.platform_admins enable row level security; -- no policy: closed to every client role

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- Totals plus the accounts that cost most. Only ids, e-mails, plans and counters: no content columns are read.
create function public.admin_overview(p_top integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.audit_log (actor_id, actor_email, workspace_id, action, target)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), null, 'admin_overview', null);
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'workspaces', (select count(*) from public.workspaces),
    'plans', jsonb_build_object(
      'pro', (select count(*) from public.user_plans where plan = 'pro'),
      'free', (select count(*) from auth.users) - (select count(*) from public.user_plans where plan = 'pro')),
    'ai', (select jsonb_build_object('calls', count(*), 'input_tokens', coalesce(sum(input_tokens), 0),
             'output_tokens', coalesce(sum(output_tokens), 0), 'cost_micro_usd', coalesce(sum(cost_micro_usd), 0))
           from public.ai_usage_events),
    'top_accounts', coalesce((select jsonb_agg(t) from (
      select e.user_id, u.email, coalesce(p.plan, 'free') as plan, count(*) as calls, sum(e.cost_micro_usd) as cost_micro_usd
      from public.ai_usage_events e
      join auth.users u on u.id = e.user_id
      left join public.user_plans p on p.user_id = e.user_id
      group by e.user_id, u.email, p.plan
      order by sum(e.cost_micro_usd) desc
      limit least(greatest(p_top, 1), 100)) t), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_overview(integer) from public, anon;
grant execute on function public.admin_overview(integer) to authenticated;
